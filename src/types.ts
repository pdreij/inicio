export type ScriptStatus = "idle" | "running" | "stopped";

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
};

export type Project = {
  id: string;
  name: string;
  path: string;
  scripts: Script[];
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
