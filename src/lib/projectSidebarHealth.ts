import type { Project } from "../types";
import { isExpectedStopSignal } from "./exitClassification";

export type SidebarProjectHealth = "running" | "warning" | "stopped";

/** Suffix after `[system] process exited (` — same shape as App `script-exit` logs (`code=…, signal=…`). */
function lastProcessExitSnippet(logs: string[]): string | undefined {
  const marker = "[system] process exited (";
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const entry = logs[i];
    const idx = entry.indexOf(marker);
    if (idx !== -1) {
      return entry.slice(idx + marker.length);
    }
  }
  return undefined;
}

function stoppedScriptHasFailedExit(logs: string[]): boolean {
  const tail = lastProcessExitSnippet(logs);
  if (tail === undefined) {
    return false;
  }

  const signalMatch = tail.match(/signal=([^,)]+)/);
  if (signalMatch !== null) {
    const sig = signalMatch[1]?.trim().toLowerCase() ?? "";
    if (sig.length > 0 && sig !== "none" && !isExpectedStopSignal(sig)) {
      return true;
    }
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
