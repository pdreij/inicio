use crate::process_manager::ProcessState;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Deserialize)]
struct PackageJsonFile {
    scripts: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct PackageJsonScriptsResponse {
    pub scripts: std::collections::HashMap<String, String>,
}

#[derive(Debug, Serialize)]
pub struct RunScriptResponse {
    pid: u32,
    package_manager: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PackageManager {
    Bun,
    Npm,
    Pnpm,
    Yarn,
}

impl PackageManager {
    fn as_str(self) -> &'static str {
        match self {
            PackageManager::Bun => "bun",
            PackageManager::Npm => "npm",
            PackageManager::Pnpm => "pnpm",
            PackageManager::Yarn => "yarn",
        }
    }
}

fn package_manager_from_corepack_field(value: &str) -> Option<PackageManager> {
    let tool = value.split('@').next()?.trim();
    match tool {
        "bun" => Some(PackageManager::Bun),
        "pnpm" => Some(PackageManager::Pnpm),
        "yarn" => Some(PackageManager::Yarn),
        "npm" => Some(PackageManager::Npm),
        _ => None,
    }
}

/// Picks a package manager from lockfiles in the project root, then
/// `package.json` `"packageManager"` (Corepack). Defaults to npm.
fn detect_package_manager(root: &Path) -> PackageManager {
    if let Ok(raw) = fs::read_to_string(root.join("package.json")) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(pm_str) = parsed
                .get("packageManager")
                .and_then(|value| value.as_str())
            {
                if let Some(pm) = package_manager_from_corepack_field(pm_str) {
                    return pm;
                }
            }
        }
    }

    if root.join("bun.lockb").exists() || root.join("bun.lock").exists() {
        return PackageManager::Bun;
    }
    if root.join("pnpm-lock.yaml").exists() {
        return PackageManager::Pnpm;
    }
    if root.join("yarn.lock").exists() {
        return PackageManager::Yarn;
    }
    if root.join("package-lock.json").exists() {
        return PackageManager::Npm;
    }
    PackageManager::Npm
}

fn spawn_script_command(root: &Path, script: &str, pm: PackageManager) -> Command {
    let script_escaped = script.replace('\'', "'\"'\"'");
    let pm_command = match pm {
        PackageManager::Bun => String::from("bun"),
        PackageManager::Npm => String::from("npm"),
        PackageManager::Pnpm => String::from("pnpm"),
        PackageManager::Yarn => String::from("yarn"),
    };
    let shell_command = format!(
        r#"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export VOLTA_HOME="${{VOLTA_HOME:-$HOME/.volta}}"
if [ -d "$VOLTA_HOME/bin" ]; then export PATH="$VOLTA_HOME/bin:$PATH"; fi
if [ -d "$HOME/.fnm" ]; then eval "$(/opt/homebrew/bin/fnm env --shell zsh 2>/dev/null || /usr/local/bin/fnm env --shell zsh 2>/dev/null || fnm env --shell zsh 2>/dev/null)"; fi
if [ -d "$HOME/.asdf" ]; then . "$HOME/.asdf/asdf.sh" 2>/dev/null || true; fi
if [ -d "$HOME/.nvm" ]; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm use --silent default >/dev/null 2>&1 || true
fi
if ! command -v {pm_command} >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    corepack {pm_command} run '{script_escaped}'
  else
    {pm_command} run '{script_escaped}'
  fi
else
  {pm_command} run '{script_escaped}'
fi
"#
    );

    // macOS GUI apps may not inherit shell PATH (nvm, bun, pnpm, etc).
    // Running through a login shell makes command discovery consistent with Terminal.
    let mut command = Command::new("/bin/zsh");
    command.args(["-l", "-c", &shell_command]);
    command.current_dir(root);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command
}

fn run_shell_command(root: &Path, command: &str) -> Result<(i32, String, String), String> {
    let shell_command = format!(
        r#"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export VOLTA_HOME="${{VOLTA_HOME:-$HOME/.volta}}"
if [ -d "$VOLTA_HOME/bin" ]; then export PATH="$VOLTA_HOME/bin:$PATH"; fi
if [ -d "$HOME/.fnm" ]; then eval "$(/opt/homebrew/bin/fnm env --shell zsh 2>/dev/null || /usr/local/bin/fnm env --shell zsh 2>/dev/null || fnm env --shell zsh 2>/dev/null)"; fi
if [ -d "$HOME/.asdf" ]; then . "$HOME/.asdf/asdf.sh" 2>/dev/null || true; fi
if [ -d "$HOME/.nvm" ]; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm use --silent default >/dev/null 2>&1 || true
fi
{}
"#,
        command
    );
    let output = Command::new("/bin/zsh")
        .args(["-l", "-c", &shell_command])
        .current_dir(root)
        .output()
        .map_err(|error| format!("Failed to run '{}': {}", command, error))?;

    let status_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((status_code, stdout, stderr))
}

fn notify_script_state(app_handle: &AppHandle, title: &str, body: String) {
    let _ = app_handle
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

fn infer_script_port(script_command: &str) -> Option<u16> {
    let mut tokens = script_command.split_whitespace().peekable();
    while let Some(token) = tokens.next() {
        if token == "--port" || token == "-p" {
            if let Some(value) = tokens.next() {
                if let Ok(port) = value.parse::<u16>() {
                    return Some(port);
                }
            }
        }

        if let Some(value) = token.strip_prefix("--port=") {
            if let Ok(port) = value.parse::<u16>() {
                return Some(port);
            }
        }
    }

    // `next dev` defaults to 3000 when no explicit port is provided.
    if script_command.contains("next dev") {
        return Some(3000);
    }

    None
}

fn find_pid_for_project_listening_on_port(path: &Path, port: u16) -> Option<u32> {
    let list_output = Command::new("/bin/zsh")
        .args([
            "-lc",
            &format!("lsof -nP -iTCP:{} -sTCP:LISTEN -t || true", port),
        ])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&list_output.stdout);
    let canonical_project = fs::canonicalize(path).ok()?;

    for line in stdout.lines() {
        let pid = match line.trim().parse::<u32>() {
            Ok(pid) => pid,
            Err(_) => continue,
        };

        let cwd_output = Command::new("/bin/zsh")
            .args(["-lc", &format!("lsof -a -p {} -d cwd -Fn || true", pid)])
            .output()
            .ok()?;
        let cwd_stdout = String::from_utf8_lossy(&cwd_output.stdout);
        let Some(cwd_line) = cwd_stdout.lines().find(|entry| entry.starts_with('n')) else {
            continue;
        };
        let cwd_path = PathBuf::from(cwd_line.trim_start_matches('n'));
        let Some(canonical_cwd) = fs::canonicalize(cwd_path).ok() else {
            continue;
        };

        if canonical_cwd == canonical_project {
            return Some(pid);
        }
    }

    None
}

fn try_adopt_existing_process(path: &str, script: &str, state: &ProcessState) -> Option<u32> {
    let package = read_package_json(path.to_string()).ok()?;
    let command = package.scripts.get(script)?;
    let port = infer_script_port(command)?;
    let pid = find_pid_for_project_listening_on_port(Path::new(path), port)?;
    let _ = state.register_running(pid, path, script);
    Some(pid)
}

#[derive(Debug, Clone, Serialize)]
pub struct AdoptedScript {
    path: String,
    script: String,
    pid: u32,
    package_manager: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutdatedPackage {
    name: String,
    current: String,
    update: String,
    latest: String,
    dependency_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OutdatedPackagesResponse {
    package_manager: String,
    packages: Vec<OutdatedPackage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateDependenciesResponse {
    package_manager: String,
    updated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectCandidate {
    path: String,
    name: String,
    scripts_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessResourceSnapshot {
    pid: u32,
    cpu_percent: f64,
    memory_mb: f64,
}

fn parse_bun_outdated(raw: &str) -> Vec<OutdatedPackage> {
    let mut packages = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('|') {
            continue;
        }
        if trimmed.contains("---") {
            continue;
        }

        let cols: Vec<String> = trimmed
            .split('|')
            .map(|col| col.trim().to_string())
            .filter(|col| !col.is_empty())
            .collect();
        if cols.len() != 4 || cols[0] == "Package" {
            continue;
        }

        let mut dependency_type = String::from("dependencies");
        let mut name = cols[0].clone();
        if let Some(stripped) = name.strip_suffix(" (dev)") {
            dependency_type = String::from("devDependencies");
            name = stripped.to_string();
        }

        packages.push(OutdatedPackage {
            name,
            current: cols[1].clone(),
            update: cols[2].clone(),
            latest: cols[3].clone(),
            dependency_type,
        });
    }

    packages
}

fn parse_npm_like_object(value: &serde_json::Value) -> Vec<OutdatedPackage> {
    let mut packages = Vec::new();
    let Some(object) = value.as_object() else {
        return packages;
    };

    for (name, meta) in object {
        let current = meta
            .get("current")
            .and_then(|v| v.as_str())
            .unwrap_or("-")
            .to_string();
        let update = meta
            .get("wanted")
            .or_else(|| meta.get("update"))
            .and_then(|v| v.as_str())
            .unwrap_or("-")
            .to_string();
        let latest = meta
            .get("latest")
            .and_then(|v| v.as_str())
            .unwrap_or("-")
            .to_string();
        let dependency_type = meta
            .get("dependencyType")
            .or_else(|| meta.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("dependencies")
            .to_string();

        packages.push(OutdatedPackage {
            name: name.to_string(),
            current,
            update,
            latest,
            dependency_type,
        });
    }

    packages
}

fn parse_pnpm_outdated(value: &serde_json::Value) -> Vec<OutdatedPackage> {
    if let Some(array) = value.as_array() {
        return array
            .iter()
            .map(|item| OutdatedPackage {
                name: item
                    .get("packageName")
                    .or_else(|| item.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("-")
                    .to_string(),
                current: item
                    .get("current")
                    .and_then(|v| v.as_str())
                    .unwrap_or("-")
                    .to_string(),
                update: item
                    .get("wanted")
                    .or_else(|| item.get("latest"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("-")
                    .to_string(),
                latest: item
                    .get("latest")
                    .and_then(|v| v.as_str())
                    .unwrap_or("-")
                    .to_string(),
                dependency_type: item
                    .get("belongsTo")
                    .or_else(|| item.get("dependencyType"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("dependencies")
                    .to_string(),
            })
            .collect();
    }

    parse_npm_like_object(value)
}

fn parse_yarn_outdated_from_json_lines(raw: &str) -> Vec<OutdatedPackage> {
    let mut packages = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };

        let Some(line_type) = value.get("type").and_then(|field| field.as_str()) else {
            continue;
        };
        if line_type != "table" {
            continue;
        }

        let Some(body) = value
            .get("data")
            .and_then(|data| data.get("body"))
            .and_then(|body| body.as_array())
        else {
            continue;
        };

        for row in body {
            let Some(columns) = row.as_array() else {
                continue;
            };
            if columns.len() < 5 {
                continue;
            }

            let name = columns
                .first()
                .and_then(|v| v.as_str())
                .unwrap_or("-")
                .to_string();
            let current = columns
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or("-")
                .to_string();
            let update = columns
                .get(2)
                .and_then(|v| v.as_str())
                .unwrap_or("-")
                .to_string();
            let latest = columns
                .get(3)
                .and_then(|v| v.as_str())
                .unwrap_or("-")
                .to_string();
            let dependency_type = columns
                .get(4)
                .and_then(|v| v.as_str())
                .unwrap_or("dependencies")
                .to_string();

            packages.push(OutdatedPackage {
                name,
                current,
                update,
                latest,
                dependency_type,
            });
        }
    }

    packages
}

fn check_outdated_with_yarn(root: &Path) -> Result<Vec<OutdatedPackage>, String> {
    let attempts = ["yarn outdated --json", "yarn npm outdated --json"];
    let mut last_error = String::new();

    for command in attempts {
        let (status_code, stdout, stderr) = run_shell_command(root, command)?;
        if status_code == 0 || status_code == 1 {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&stdout) {
                return Ok(parse_npm_like_object(&parsed));
            }

            let parsed = parse_yarn_outdated_from_json_lines(&stdout);
            if !parsed.is_empty() || stdout.trim().is_empty() {
                return Ok(parsed);
            }
        }

        last_error = if stderr.is_empty() { stdout } else { stderr };
    }

    Err(format!(
        "Could not check outdated packages with yarn: {}",
        if last_error.is_empty() {
            "unknown yarn error".to_string()
        } else {
            last_error
        }
    ))
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptLogEvent {
    pid: u32,
    path: String,
    script: String,
    stream: String,
    line: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptExitEvent {
    pid: u32,
    path: String,
    script: String,
    code: Option<i32>,
    signal: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptStartEvent {
    pid: u32,
    path: String,
    script: String,
    package_manager: String,
}

#[tauri::command]
pub fn open_folder_picker() -> Option<String> {
    FileDialog::new()
        .pick_folder()
        .map(|path| path.display().to_string())
}

fn should_skip_nested_dir(dir_name: &str) -> bool {
    matches!(
        dir_name,
        "node_modules" | ".git" | ".next" | "dist" | "build" | "target"
    )
}

fn collect_child_projects(root: &Path, collected: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(root)
        .map_err(|error| format!("Could not read directory {}: {}", root.display(), error))?;

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Could not inspect directory {}: {}", root.display(), error))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let dir_name = entry.file_name();
        let dir_name = dir_name.to_string_lossy();
        if should_skip_nested_dir(&dir_name) {
            continue;
        }

        if path.join("package.json").exists() {
            collected.push(path);
            continue;
        }

        collect_child_projects(&path, collected)?;
    }

    Ok(())
}

#[tauri::command]
pub fn discover_project_paths(path: String) -> Result<Vec<String>, String> {
    let root = Path::new(&path);
    if !root.is_dir() {
        return Err(format!("Selected path is not a directory: {}", path));
    }

    if root.join("package.json").exists() {
        return Ok(vec![path]);
    }

    let mut discovered = Vec::new();
    collect_child_projects(root, &mut discovered)?;
    discovered.sort();

    Ok(discovered
        .into_iter()
        .map(|project_path| project_path.display().to_string())
        .collect())
}

#[tauri::command]
pub fn discover_project_candidates(path: String) -> Result<Vec<ProjectCandidate>, String> {
    let project_paths = discover_project_paths(path)?;
    let mut candidates = Vec::new();

    for project_path in project_paths {
        if let Ok(scripts) = read_package_json(project_path.clone()) {
            let name = Path::new(&project_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&project_path)
                .to_string();
            candidates.push(ProjectCandidate {
                path: project_path,
                name,
                scripts_count: scripts.scripts.len(),
            });
        }
    }

    Ok(candidates)
}

#[tauri::command]
pub fn read_package_json(path: String) -> Result<PackageJsonScriptsResponse, String> {
    let package_json_path = std::path::Path::new(&path).join("package.json");
    let raw = fs::read_to_string(&package_json_path)
        .map_err(|error| format!("Could not read {}: {}", package_json_path.display(), error))?;

    let parsed: PackageJsonFile = serde_json::from_str(&raw)
        .map_err(|error| format!("Invalid package.json in {}: {}", path, error))?;

    Ok(PackageJsonScriptsResponse {
        scripts: parsed.scripts.unwrap_or_default(),
    })
}

#[tauri::command]
pub fn check_outdated_packages(path: String) -> Result<OutdatedPackagesResponse, String> {
    let root = Path::new(&path);
    let package_manager = detect_package_manager(root);

    let (status_code, stdout, stderr) = match package_manager {
        PackageManager::Bun => run_shell_command(root, "bun outdated --no-progress --no-summary")?,
        PackageManager::Npm => run_shell_command(root, "npm outdated --json")?,
        PackageManager::Pnpm => run_shell_command(root, "pnpm outdated --format json")?,
        PackageManager::Yarn => (0, String::new(), String::new()),
    };

    let packages = match package_manager {
        PackageManager::Bun => {
            if status_code != 0 {
                return Err(format!(
                    "Could not check outdated packages with bun: {}",
                    if stderr.is_empty() { stdout } else { stderr }
                ));
            }
            parse_bun_outdated(&stdout)
        }
        PackageManager::Npm => {
            if status_code != 0 && status_code != 1 {
                return Err(format!(
                    "Could not check outdated packages with npm: {}",
                    if stderr.is_empty() { stdout } else { stderr }
                ));
            }
            if stdout.trim().is_empty() {
                Vec::new()
            } else {
                let parsed: serde_json::Value = serde_json::from_str(&stdout).map_err(|error| {
                    format!("Failed to parse npm outdated output as JSON: {}", error)
                })?;
                parse_npm_like_object(&parsed)
            }
        }
        PackageManager::Pnpm => {
            if status_code != 0 && status_code != 1 {
                return Err(format!(
                    "Could not check outdated packages with pnpm: {}",
                    if stderr.is_empty() { stdout } else { stderr }
                ));
            }
            if stdout.trim().is_empty() {
                Vec::new()
            } else {
                let parsed: serde_json::Value = serde_json::from_str(&stdout).map_err(|error| {
                    format!("Failed to parse pnpm outdated output as JSON: {}", error)
                })?;
                parse_pnpm_outdated(&parsed)
            }
        }
        PackageManager::Yarn => check_outdated_with_yarn(root)?,
    };

    Ok(OutdatedPackagesResponse {
        package_manager: package_manager.as_str().to_string(),
        packages,
    })
}

#[tauri::command]
pub fn update_dependencies(
    path: String,
    include_major: bool,
    package_names: Option<Vec<String>>,
) -> Result<UpdateDependenciesResponse, String> {
    let root = Path::new(&path);
    let package_manager = detect_package_manager(root);
    let selected_packages = package_names.unwrap_or_default();
    let has_selected_packages = !selected_packages.is_empty();
    let joined_packages = selected_packages.join(" ");

    let command = match package_manager {
        PackageManager::Bun => {
            if include_major {
                if has_selected_packages {
                    format!(
                        "bun update --latest --no-progress --no-summary {}",
                        joined_packages
                    )
                } else {
                    String::from("bun update --latest --no-progress --no-summary")
                }
            } else {
                if has_selected_packages {
                    format!("bun update --no-progress --no-summary {}", joined_packages)
                } else {
                    String::from("bun update --no-progress --no-summary")
                }
            }
        }
        PackageManager::Npm => {
            if include_major {
                if has_selected_packages {
                    let selected_latest = selected_packages
                        .iter()
                        .map(|name| format!("{}@latest", name))
                        .collect::<Vec<String>>()
                        .join(" ");
                    format!("npm install {}", selected_latest)
                } else {
                    String::from("packages=$(npm outdated --json | node -e \"let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{if(!d.trim()){console.log('');return;}const o=JSON.parse(d);console.log(Object.keys(o).map((name)=>name+'@latest').join(' '));})\"); if [ -n \"$packages\" ]; then npm install ${=packages}; fi")
                }
            } else {
                if has_selected_packages {
                    format!("npm update {}", joined_packages)
                } else {
                    String::from("npm update")
                }
            }
        }
        PackageManager::Pnpm => {
            if include_major {
                if has_selected_packages {
                    format!("pnpm update --latest {}", joined_packages)
                } else {
                    String::from("pnpm update --latest")
                }
            } else {
                if has_selected_packages {
                    format!("pnpm update {}", joined_packages)
                } else {
                    String::from("pnpm update")
                }
            }
        }
        PackageManager::Yarn => {
            let attempts = if include_major {
                ["yarn upgrade --latest", "yarn up -R"]
            } else {
                ["yarn upgrade", "yarn up"]
            };
            let mut last_error = String::new();
            for yarn_command in attempts {
                let full_command = if has_selected_packages {
                    if yarn_command.contains("--latest") {
                        let selected_latest = selected_packages
                            .iter()
                            .map(|name| format!("{}@latest", name))
                            .collect::<Vec<String>>()
                            .join(" ");
                        format!("{} {}", yarn_command, selected_latest)
                    } else {
                        format!("{} {}", yarn_command, joined_packages)
                    }
                } else {
                    yarn_command.to_string()
                };
                let (status_code, stdout, stderr) = run_shell_command(root, &full_command)?;
                if status_code == 0 {
                    return Ok(UpdateDependenciesResponse {
                        package_manager: package_manager.as_str().to_string(),
                        updated: true,
                    });
                }
                last_error = if stderr.is_empty() { stdout } else { stderr };
            }
            return Err(format!(
                "Failed to update dependencies with yarn: {}",
                if last_error.is_empty() {
                    "unknown yarn error".to_string()
                } else {
                    last_error
                }
            ));
        }
    };

    let (status_code, stdout, stderr) = run_shell_command(root, &command)?;
    if status_code != 0 {
        return Err(format!(
            "Failed to update dependencies with {}: {}",
            package_manager.as_str(),
            if stderr.is_empty() { stdout } else { stderr }
        ));
    }

    Ok(UpdateDependenciesResponse {
        package_manager: package_manager.as_str().to_string(),
        updated: true,
    })
}

#[tauri::command]
pub fn get_process_resources(pids: Vec<u32>) -> Result<Vec<ProcessResourceSnapshot>, String> {
    if pids.is_empty() {
        return Ok(Vec::new());
    }

    let pid_list = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<String>>()
        .join(",");
    let command = format!("ps -p {} -o pid=,%cpu=,rss=", pid_list);
    let output = Command::new("/bin/zsh")
        .args(["-lc", &command])
        .output()
        .map_err(|error| format!("Failed to collect process resources: {}", error))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "Failed to collect process resources: {}",
            if stderr.is_empty() {
                "ps exited with non-zero status".to_string()
            } else {
                stderr
            }
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut snapshots = Vec::new();
    for line in stdout.lines() {
        let cols = line.split_whitespace().collect::<Vec<&str>>();
        if cols.len() < 3 {
            continue;
        }
        let Ok(pid) = cols[0].parse::<u32>() else {
            continue;
        };
        let Ok(cpu_percent) = cols[1].replace(',', ".").parse::<f64>() else {
            continue;
        };
        let Ok(rss_kb) = cols[2].parse::<f64>() else {
            continue;
        };
        snapshots.push(ProcessResourceSnapshot {
            pid,
            cpu_percent,
            memory_mb: rss_kb / 1024.0,
        });
    }

    Ok(snapshots)
}

#[tauri::command]
pub fn run_script(
    app_handle: AppHandle,
    path: String,
    script: String,
    state: State<'_, ProcessState>,
) -> Result<RunScriptResponse, String> {
    if let Some(existing_pid) = state.get_running_pid(&path, &script)? {
        return Err(format!(
            "Script '{}' is already running (pid {}). Stop it before starting again.",
            script, existing_pid
        ));
    }
    if let Some(adopted_pid) = try_adopt_existing_process(&path, &script, &state) {
        let start_payload = ScriptStartEvent {
            pid: adopted_pid,
            path: path.clone(),
            script: script.clone(),
            package_manager: String::from("external"),
        };
        let _ = app_handle.emit("script-start", start_payload);
        let _ = crate::refresh_tray_menu(&app_handle);
        notify_script_state(
            &app_handle,
            "Script attached",
            format!("{} is already running (pid {})", script, adopted_pid),
        );
        return Ok(RunScriptResponse {
            pid: adopted_pid,
            package_manager: String::from("external"),
        });
    }

    let root = Path::new(&path);
    let package_manager = detect_package_manager(root);
    let mut child = spawn_script_command(root, &script, package_manager)
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to run script '{}' with {}: {}",
                script,
                package_manager.as_str(),
                error
            )
        })?;

    let pid = child.id();

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let child_handle = Arc::new(Mutex::new(child));

    {
        let mut children = state
            .children
            .lock()
            .map_err(|_| String::from("Failed to lock process state"))?;
        children.insert(pid, child_handle.clone());
    }
    state.register_running(pid, &path, &script)?;
    let start_payload = ScriptStartEvent {
        pid,
        path: path.clone(),
        script: script.clone(),
        package_manager: package_manager.as_str().to_string(),
    };
    let _ = app_handle.emit("script-start", start_payload);
    let _ = crate::refresh_tray_menu(&app_handle);
    notify_script_state(
        &app_handle,
        "Script started",
        format!("{} ({})", script, package_manager.as_str()),
    );

    if let Some(stdout_pipe) = stdout {
        let app_clone = app_handle.clone();
        let script_clone = script.clone();
        let path_clone = path.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout_pipe);
            for line in reader.lines().map_while(Result::ok) {
                let payload = ScriptLogEvent {
                    pid,
                    path: path_clone.clone(),
                    script: script_clone.clone(),
                    stream: String::from("stdout"),
                    line,
                };
                let _ = app_clone.emit("script-log", payload);
            }
        });
    }

    if let Some(stderr_pipe) = stderr {
        let app_clone = app_handle.clone();
        let script_clone = script.clone();
        let path_clone = path.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr_pipe);
            for line in reader.lines().map_while(Result::ok) {
                let payload = ScriptLogEvent {
                    pid,
                    path: path_clone.clone(),
                    script: script_clone.clone(),
                    stream: String::from("stderr"),
                    line,
                };
                let _ = app_clone.emit("script-log", payload);
            }
        });
    }

    let app_clone = app_handle.clone();
    let script_clone = script.clone();
    let path_clone = path.clone();
    let children_map = state.children.clone();
    std::thread::spawn(move || {
        let status_result = match child_handle.lock() {
            Ok(mut child) => child.wait(),
            Err(_) => return,
        };

        if let Ok(status) = status_result {
            if let Ok(mut children) = children_map.lock() {
                children.remove(&pid);
            }
            let process_state = app_clone.state::<ProcessState>();
            let _ = process_state.unregister_running(pid);

            let script_for_notification = script_clone.clone();
            let payload = ScriptExitEvent {
                pid,
                path: path_clone,
                script: script_clone,
                code: status.code(),
                signal: None,
            };
            let did_fail = match status.code() {
                Some(code) => code != 0,
                None => true,
            };
            let _ = app_clone.emit("script-exit", payload);
            let _ = crate::refresh_tray_menu(&app_clone);
            if did_fail {
                notify_script_state(
                    &app_clone,
                    "Script failed",
                    format!(
                        "{} exited with code {}",
                        script_for_notification,
                        status.code().unwrap_or(-1)
                    ),
                );
            } else {
                notify_script_state(
                    &app_clone,
                    "Script stopped",
                    format!("{} exited successfully", script_for_notification),
                );
            }
        }
    });

    Ok(RunScriptResponse {
        pid,
        package_manager: package_manager.as_str().to_string(),
    })
}

#[tauri::command]
pub fn adopt_running_scripts(
    app_handle: AppHandle,
    projects: Vec<SavedProject>,
    state: State<'_, ProcessState>,
) -> Result<Vec<AdoptedScript>, String> {
    let mut adopted = Vec::new();

    for project in projects {
        let scripts_response = match read_package_json(project.path.clone()) {
            Ok(scripts) => scripts,
            Err(_) => continue,
        };

        for script_name in scripts_response.scripts.keys() {
            if let Some(existing_pid) = state.get_running_pid(&project.path, script_name)? {
                adopted.push(AdoptedScript {
                    path: project.path.clone(),
                    script: script_name.clone(),
                    pid: existing_pid,
                    package_manager: String::from("external"),
                });
                continue;
            }

            if let Some(pid) = try_adopt_existing_process(&project.path, script_name, &state) {
                adopted.push(AdoptedScript {
                    path: project.path.clone(),
                    script: script_name.clone(),
                    pid,
                    package_manager: String::from("external"),
                });
            }
        }
    }

    if !adopted.is_empty() {
        let _ = crate::refresh_tray_menu(&app_handle);
    }
    Ok(adopted)
}

#[tauri::command]
pub fn stop_process(
    app_handle: AppHandle,
    pid: u32,
    state: State<'_, ProcessState>,
) -> Result<(), String> {
    let mut children = state
        .children
        .lock()
        .map_err(|_| String::from("Failed to lock process state"))?;
    let child = children.remove(&pid);
    drop(children);

    if let Some(child) = child {
        let mut child_guard = child
            .lock()
            .map_err(|_| format!("Failed to lock process {}", pid))?;
        child_guard
            .kill()
            .map_err(|error| format!("Failed to stop process {}: {}", pid, error))?;
    } else {
        let status = Command::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|error| format!("Failed to stop process {}: {}", pid, error))?;
        if !status.success() {
            return Err(format!("No running process found for pid {}", pid));
        }
    }
    let _ = state.unregister_running(pid);
    let _ = crate::refresh_tray_menu(&app_handle);
    notify_script_state(
        &app_handle,
        "Script stop requested",
        format!("PID {} received termination signal", pid),
    );

    Ok(())
}

// --- Persisted projects (id, name, path only; scripts re-read on load) ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedProject {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedProjectsFile {
    pub projects: Vec<SavedProject>,
    pub active_project_id: Option<String>,
}

fn projects_storage_path() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| String::from("Could not resolve app data directory"))?;
    Ok(base.join("inicio").join("projects.json"))
}

#[tauri::command]
pub fn load_projects() -> Result<SavedProjectsFile, String> {
    let path = projects_storage_path()?;
    if !path.exists() {
        return Ok(SavedProjectsFile {
            projects: Vec::new(),
            active_project_id: None,
        });
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {}", path.display(), error))?;

    let parsed: SavedProjectsFile = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "Invalid projects file at {}: {}. You can delete the file to reset.",
            path.display(),
            error
        )
    })?;

    Ok(parsed)
}

#[tauri::command]
pub fn save_projects(app_handle: AppHandle, payload: SavedProjectsFile) -> Result<(), String> {
    let path = projects_storage_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let raw = serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?;
    fs::write(&path, raw).map_err(|error| format!("Could not write {}: {}", path.display(), error))?;
    let _ = crate::refresh_tray_menu(&app_handle);

    Ok(())
}
