import type { Project } from "../types";

export type SidebarProjectHealth = "running" | "warning" | "stopped";

/** Last `[system] process exited (` line suffix, e.g. `code=1, signal=none)`. */
function lastProcessExitSnippet(logs: string[]): string | undefined {
  let found: string | undefined;
  for (const entry of logs) {
    const idx = entry.indexOf("[system] process exited (");
    if (idx !== -1) {
      found = entry.slice(idx + "[system] process exited (".length);
    }
  }
  return found;
}

function stoppedScriptHasFailedExit(logs: string[]): boolean {
  const tail = lastProcessExitSnippet(logs);
  if (tail === undefined) {
    return false;
  }
  const codeMatch = tail.match(/code=([^,)]+)/);
  if (codeMatch === null) {
    return false;
  }
  const raw = codeMatch[1]?.trim() ?? "";
  if (raw === "none") {
    return false;
  }
  const numeric = Number.parseInt(raw, 10);
  if (Number.isNaN(numeric)) {
    return true;
  }
  return numeric !== 0;
}

export function getProjectSidebarHealth(project: Project): SidebarProjectHealth {
  const hasRunning = project.scripts.some(
    (script) => script.status === "running",
  );
  if (hasRunning) {
    return "running";
  }

  if (project.importError !== undefined && project.importError.length > 0) {
    return "warning";
  }

  const warningStop = project.scripts.some(
    (script) =>
      script.status === "stopped" && stoppedScriptHasFailedExit(script.logs),
  );
  if (warningStop) {
    return "warning";
  }

  return "stopped";
}
