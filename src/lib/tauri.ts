import { invoke } from "@tauri-apps/api/core";

export type SavedProject = {
  id: string;
  name: string;
  path: string;
};

export type SavedProjectsFile = {
  projects: SavedProject[];
  activeProjectId: string | null;
};

export type PackageJsonScriptsResponse = {
  scripts: Record<string, string>;
};

export type ProjectCandidate = {
  path: string;
  name: string;
  scripts_count: number;
};

export type RunScriptResponse = {
  pid: number;
  package_manager: string;
};

export type OutdatedPackage = {
  name: string;
  current: string;
  update: string;
  latest: string;
  dependency_type: string;
};

export type OutdatedPackagesResponse = {
  package_manager: string;
  packages: OutdatedPackage[];
};

export type UpdateDependenciesResponse = {
  package_manager: string;
  updated: boolean;
};

export type ProcessResourceSnapshot = {
  pid: number;
  cpu_percent: number;
  memory_mb: number;
};

export type AdoptedScript = {
  path: string;
  script: string;
  pid: number;
  package_manager: string;
};

export async function openFolderPicker(): Promise<string | null> {
  return invoke("open_folder_picker");
}

export async function readPackageJson(
  path: string,
): Promise<PackageJsonScriptsResponse> {
  return invoke("read_package_json", { path });
}

export async function discoverProjectPaths(path: string): Promise<string[]> {
  return invoke("discover_project_paths", { path });
}

export async function discoverProjectCandidates(
  path: string,
): Promise<ProjectCandidate[]> {
  return invoke("discover_project_candidates", { path });
}

export async function runScript(
  path: string,
  script: string,
): Promise<RunScriptResponse> {
  return invoke("run_script", { path, script });
}

export async function stopProcess(pid: number): Promise<void> {
  return invoke("stop_process", { pid });
}

export async function loadProjects(): Promise<SavedProjectsFile> {
  return invoke("load_projects");
}

export async function saveProjects(payload: SavedProjectsFile): Promise<void> {
  return invoke("save_projects", { payload });
}

export async function checkOutdatedPackages(
  path: string,
): Promise<OutdatedPackagesResponse> {
  return invoke("check_outdated_packages", { path });
}

export async function updateDependencies(
  path: string,
  includeMajor: boolean,
  packageNames?: string[],
): Promise<UpdateDependenciesResponse> {
  return invoke("update_dependencies", { path, includeMajor, packageNames });
}

export async function adoptRunningScripts(
  projects: SavedProject[],
): Promise<AdoptedScript[]> {
  return invoke("adopt_running_scripts", { projects });
}

export async function getProcessResources(
  pids: number[],
): Promise<ProcessResourceSnapshot[]> {
  return invoke("get_process_resources", { pids });
}
