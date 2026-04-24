type LogsPanelProps = {
  logs: string[];
};

export function LogsPanel({ logs }: LogsPanelProps) {
  return (
    <div className="max-h-60 overflow-auto border-t border-white/20 bg-[#0a1f2a]/90 p-3">
      {logs.length === 0 ? (
        <p className="text-xs text-slate-400">No logs yet.</p>
      ) : (
        logs.map((line, index) => (
          <pre
            className="m-0 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-200"
            key={`${line}-${index}`}
          >
            {line}
          </pre>
        ))
      )}
    </div>
  );
}
