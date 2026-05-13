import { memo } from "react";
import { LogsPanel } from "./LogsPanel";
import type { Script } from "../types";

type ScriptRowProps = {
  script: Script;
  isPinned: boolean;
  /** Precomputed sorted PIDs (`a,b,c`). Must match `managedScriptPids` contents. */
  managedScriptPidSignature: string;
  managedScriptPids: ReadonlySet<number>;
  onRun: () => void;
  onStop: () => void;
  onToggleLogs: () => void;
  onTogglePin: () => void;
  onDismissPortConflict: () => void;
};

function suggestAlternatePort(
  inferredPort: number | null,
  conflictPorts: number[],
): number {
  const base = inferredPort ?? conflictPorts[0] ?? 3000;
  if (base >= 65535) {
    return Math.max(1, base - 1);
  }
  const candidate = base + 1;
  return Math.min(65535, candidate);
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function statusLabel(script: Script): string {
  if (script.status === "running" && script.externalRunning) {
    return "Running (external)";
  }
  const status = script.status;
  switch (status) {
    case "running":
      return "Running";
    case "idle":
      return script.lastRunSucceeded === true ? "Succeeded" : "Idle";
    case "stopped":
      return "Stopped";
    default: {
      const exhaustiveCheck: never = status;
      return exhaustiveCheck;
    }
  }
}

function ScriptRowComponent({
  script,
  isPinned,
  managedScriptPidSignature: _memoManagedPidSig,
  managedScriptPids,
  onRun,
  onStop,
  onToggleLogs,
  onTogglePin,
  onDismissPortConflict,
}: ScriptRowProps) {
  const canRun = script.status !== "running";
  const canStop = script.status === "running" && script.pid !== undefined;
  const statusClass =
    script.status === "running"
      ? "border-brand-green/55 bg-brand-green/20 text-brand-green"
      : script.status === "stopped"
        ? "border-rose-400/50 bg-rose-500/20 text-rose-200"
        : script.lastRunSucceeded === true
          ? "border-brand-green/40 bg-brand-green/14 text-brand-green"
          : "border-white/30 bg-white/10 text-slate-100";

  const hint = script.portConflictHint;
  const altPort =
    hint === undefined
      ? null
      : suggestAlternatePort(hint.inferredPort, hint.ports);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#6edfd0]/35 bg-[linear-gradient(145deg,rgba(20,88,105,0.62),rgba(13,54,67,0.78))] shadow-xl shadow-black/25">
      <div className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide ${statusClass}`}
            >
              {statusLabel(script)}
            </span>
            {isPinned ? (
              <span className="shrink-0 rounded-md border border-amber-300/35 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-100">
                Pinned
              </span>
            ) : null}
            <p className="truncate text-base font-semibold text-white">
              {script.name}
            </p>
            <p className="min-w-32 flex-1 truncate text-sm text-slate-100/80">
              {script.command}
            </p>
            {script.status === "running" ? (
              <p className="shrink-0 text-[11px] text-slate-200/80">
                CPU {script.cpuPercent?.toFixed(1) ?? "--"}% · RAM{" "}
                {script.memoryMb?.toFixed(0) ?? "--"} MB
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            aria-label={isPinned ? "Unpin script" : "Pin script to top"}
            className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              isPinned
                ? "border-amber-300/55 bg-amber-400/20 text-amber-50 hover:bg-amber-400/28"
                : "border-white/25 bg-white/10 text-slate-100 hover:bg-white/16"
            }`}
            onClick={onTogglePin}
            title={isPinned ? "Unpin" : "Pin to top"}
            type="button"
          >
            {isPinned ? "Unpin" : "Pin"}
          </button>
          <button
            className="rounded-md border border-brand-green/45 bg-brand-green/20 px-2 py-1 text-[11px] font-semibold text-brand-green transition hover:bg-brand-green/30 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canRun}
            onClick={onRun}
            type="button"
          >
            Run
          </button>
          <button
            className="rounded-md border border-rose-400/45 bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canStop}
            onClick={onStop}
            type="button"
          >
            Stop
          </button>
          <button
            className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onToggleLogs}
            type="button"
          >
            {script.isLogsOpen ? "Hide Logs" : "Show Logs"}
          </button>
        </div>
      </div>
      {hint !== undefined ? (
        <div className="space-y-2 border-t border-amber-300/35 bg-amber-500/15 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-xs font-semibold text-amber-50">
              Port conflict
              {hint.ports.length > 0 ? ` (ports ${hint.ports.join(", ")})` : ""}
              {hint.inferredPort !== null
                ? ` · Inferred script default ${hint.inferredPort}`
                : ""}
            </p>
            <button
              className="shrink-0 rounded-md border border-white/25 bg-white/10 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-white/18"
              onClick={onDismissPortConflict}
              type="button"
            >
              Dismiss
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-amber-100/90">
            Another process may already own this port.
            {altPort !== null
              ? ` After freeing the port, try adding \`--port ${altPort}\` (or \`PORT=${altPort}\` before your command).`
              : null}
          </p>
          {hint.listeners.length > 0 ? (
            <ul className="space-y-2 text-[11px] text-slate-100">
              {hint.listeners.map((listener) => {
                const tracked = managedScriptPids.has(listener.pid);
                return (
                  <li
                    className="rounded-lg border border-white/15 bg-black/22 px-3 py-2 font-mono"
                    key={`${listener.pid}-${listener.command}`}
                  >
                    <div className="text-slate-200/95">
                      <span className="text-brand-cyan/95">
                        PID {listener.pid}
                      </span>
                      {" · "}
                      {listener.command}
                    </div>
                    {listener.cwd !== undefined &&
                    listener.cwd !== null &&
                    listener.cwd !== "" ? (
                      <div className="mt-1 truncate text-slate-400/95">
                        cwd {listener.cwd}
                      </div>
                    ) : null}
                    {tracked ? (
                      <p className="mt-2 text-brand-green/95">
                        This PID is tracked as a script in Inicio — use Stop
                        above for that script instead of killing from the
                        terminal.
                      </p>
                    ) : null}
                    <button
                      className="mt-2 rounded border border-white/22 bg-white/10 px-2 py-1 text-[10px] font-semibold text-slate-50 transition hover:bg-white/16"
                      onClick={() =>
                        writeClipboard(`kill ${listener.pid}`).catch(() => {
                          /* ignore */
                        })
                      }
                      type="button"
                    >
                      Copy kill {listener.pid}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-200/85">
              No LISTEN rows returned from lsof yet — retry Run after checking
              the port manually.
            </p>
          )}
        </div>
      ) : null}
      {script.isLogsOpen ? <LogsPanel logs={script.logs} /> : null}
    </div>
  );
}

function portConflictFingerprint(script: Script): string {
  const h = script.portConflictHint;
  if (h === undefined) {
    return "";
  }
  return `${h.ports.join(",")}|${h.listeners
    .map((l) => `${l.pid}:${l.command}:${l.cwd ?? ""}`)
    .join(";")}|${h.inferredPort ?? "null"}`;
}

export const ScriptRow = memo(
  ScriptRowComponent,
  (prev, next) =>
    prev.script.name === next.script.name &&
    prev.script.command === next.script.command &&
    prev.script.status === next.script.status &&
    prev.script.pid === next.script.pid &&
    prev.script.isLogsOpen === next.script.isLogsOpen &&
    prev.script.externalRunning === next.script.externalRunning &&
    prev.script.cpuPercent === next.script.cpuPercent &&
    prev.script.memoryMb === next.script.memoryMb &&
    prev.script.logs.length === next.script.logs.length &&
    prev.script.lastRunSucceeded === next.script.lastRunSucceeded &&
    prev.isPinned === next.isPinned &&
    prev.managedScriptPidSignature === next.managedScriptPidSignature &&
    portConflictFingerprint(prev.script) ===
      portConflictFingerprint(next.script),
);
