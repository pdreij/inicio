export type ScriptStatus = "idle" | "running" | "stopped";

export type TcpPortListener = {
  pid: number;
  command: string;
  cwd?: string | null;
};

export type PortConflictHint = {
  ports: number[];
  listeners: TcpPortListener[];
  inferredPort: number | null;
};

export type Script = {
  name: string;
  command: string;
  status: ScriptStatus;
  logs: string[];
  pid?: number;
  isLogsOpen?: boolean;
  externalRunning?: boolean;
  cpuPercent?: number;
  memoryMb?: number;
  /** True after last process exit was successful (clean); cleared when a new run starts. */
  lastRunSucceeded?: boolean;

  portConflictHint?: PortConflictHint;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  scripts: Script[];
  /** Script names shown first (in order); persisted with the project. */
  pinnedScripts: string[];
  /** Set when restoring from disk and package.json could not be read. */
  importError?: string;
};

export type AppState = {
  projects: Project[];
  activeProjectId?: string;
};

export type OutdatedPackage = {
  name: string;
  current: string;
  update: string;
  latest: string;
  dependency_type: string;
};

export type OutdatedPackagesData = {
  packageManager: string;
  packages: OutdatedPackage[];
  error?: string;
  lastCheckedAt?: string;
};

export type LogEventPayload = {
  pid: number;
  path: string;
  script: string;
  stream: "stdout" | "stderr";
  line: string;
};

export type ProcessExitPayload = {
  pid: number;
  path: string;
  script: string;
  code: number | null;
  signal: string | null;
};

export type ProcessStartPayload = {
  pid: number;
  path: string;
  script: string;
  package_manager: string;
};
