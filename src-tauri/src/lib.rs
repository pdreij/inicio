mod commands;
mod process_manager;

use commands::{load_projects, read_package_json, SavedProject};
use process_manager::ProcessState;
use std::io;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

fn menu_item_id(prefix: &str, project_id: &str, script: &str) -> String {
    format!("{prefix}::{project_id}::{script}")
}

fn decode_script_menu_id(raw: &str) -> Option<(String, String, String)> {
    let mut parts = raw.splitn(3, "::");
    let action = parts.next()?.to_string();
    let project_id = parts.next()?.to_string();
    let script = parts.next()?.to_string();
    Some((action, project_id, script))
}

fn script_menu_item_label(script: &str, running_pid: Option<u32>) -> String {
    match running_pid {
        Some(pid) => format!("Stop {script} (pid {pid})"),
        None => format!("Start {script}"),
    }
}

fn resolve_running_pid(
    process_state: &State<'_, ProcessState>,
    project: &SavedProject,
    script_name: &str,
) -> Option<u32> {
    process_state
        .get_running_pid(&project.path, script_name)
        .ok()
        .flatten()
}

pub(crate) fn refresh_tray_menu(app_handle: &AppHandle) -> Result<(), String> {
    let process_state = app_handle.state::<ProcessState>();
    let saved = load_projects()?;
    let mut menu_builder = MenuBuilder::new(app_handle);

    for project in &saved.projects {
        let scripts_response = match read_package_json(project.path.clone()) {
            Ok(response) => response,
            Err(_) => continue,
        };

        let mut script_names: Vec<String> = scripts_response.scripts.keys().cloned().collect();
        script_names.sort();
        let mut project_submenu = SubmenuBuilder::new(app_handle, project.name.clone());

        for script_name in script_names {
            let running_pid = resolve_running_pid(&process_state, &project, &script_name);
            let action = if running_pid.is_some() { "stop" } else { "start" };
            let menu_id = menu_item_id(action, &project.id, &script_name);
            let label = script_menu_item_label(&script_name, running_pid);
            project_submenu = project_submenu.text(menu_id, label);
        }

        if scripts_response.scripts.is_empty() {
            project_submenu = project_submenu.text(
                format!("project-empty::{}", project.id),
                "No scripts found",
            );
        }

        let built_project = project_submenu.build().map_err(|error| error.to_string())?;
        menu_builder = menu_builder.item(&built_project);
    }

    if saved.projects.is_empty() {
        menu_builder = menu_builder.text("no-projects", "No projects added yet");
    }

    let menu = menu_builder
        .separator()
        .text("open-window", "Open Inicio")
        .text("quit", "Quit")
        .build()
        .map_err(|error| error.to_string())?;
    if let Some(tray) = app_handle.tray_by_id("main-tray") {
        tray.set_menu(Some(menu)).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ProcessState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();

            let mut tray_builder = TrayIconBuilder::with_id("main-tray").show_menu_on_left_click(true);
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder
                .on_menu_event(move |app, event| {
                    let id = event.id().0.clone();

                    if id == "quit" {
                        app.exit(0);
                        return;
                    }

                    if id == "open-window" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        return;
                    }

                    let Some((action, project_id, script_name)) = decode_script_menu_id(&id) else {
                        return;
                    };

                    let saved = match load_projects() {
                        Ok(saved) => saved,
                        Err(_) => return,
                    };
                    let project = match saved.projects.iter().find(|project| project.id == project_id) {
                        Some(project) => project,
                        None => return,
                    };

                    let running_pid = app
                        .state::<ProcessState>()
                        .get_running_pid(&project.path, &script_name)
                        .ok()
                        .flatten();

                    match action.as_str() {
                        "start" => {
                            if running_pid.is_none() {
                                let state = app.state::<ProcessState>();
                                let _ =
                                    commands::run_script(app.clone(), project.path.clone(), script_name.clone(), state);
                            }
                        }
                        "stop" => {
                            if let Some(pid) = running_pid {
                                let state = app.state::<ProcessState>();
                                let _ = commands::stop_process(app.clone(), pid, state);
                            }
                        }
                        _ => {}
                    }

                    let _ = refresh_tray_menu(app);
                    let _ = app.emit("tray-action", id);
                })
                .build(app)
                .map_err(|error| io::Error::other(error.to_string()))?;

            refresh_tray_menu(&app_handle).map_err(io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_folder_picker,
            commands::discover_project_paths,
            commands::discover_project_candidates,
            commands::read_package_json,
            commands::run_script,
            commands::stop_process,
            commands::load_projects,
            commands::save_projects,
            commands::check_outdated_packages,
            commands::update_dependencies,
            commands::adopt_running_scripts,
            commands::get_process_resources
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            app_handle.state::<ProcessState>().terminate_all();
        }
    });
}
