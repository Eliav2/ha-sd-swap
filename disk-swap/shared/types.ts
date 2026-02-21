/** Raw block device from lsblk --json output */
export interface RawBlockDevice {
  name: string;
  size: number | string;
  type: string;
  tran: string | null;
  vendor: string | null;
  model: string | null;
  serial: string | null;
}

/** Filtered, safe USB device returned by GET /api/devices */
export interface Device {
  name: string;
  path: string;
  size: number;
  size_human: string;
  vendor: string;
  model: string;
  tran: string;
  serial: string;
}

/** Response shape for GET /api/devices */
export interface DevicesResponse {
  devices: Device[];
}

/** Response shape for GET /api/system-info */
export interface SystemInfoResponse {
  machine: string;
  board_slug: string;
  os_version: string;
  os_version_latest: string;
  ip_address: string;
  free_space_bytes: number;
  free_space_human: string;
}

/** Supervisor GET /info response data */
export interface SupervisorInfo {
  machine: string;
  arch: string;
  supported: boolean;
  channel: string;
}

/** Supervisor GET /os/info response data */
export interface OsInfo {
  version: string;
  version_latest: string;
  board: string;
}

/** Supervisor GET /host/info response data (subset we use).
 *  Note: disk values are in GB (float), not bytes. */
export interface HostInfo {
  hostname: string;
  disk_total: number;
  disk_used: number;
  disk_free: number;
}

/** Supervisor GET /network/info response data (subset we use) */
export interface NetworkInfo {
  interfaces: Array<{
    interface: string;
    ipv4?: { address?: string[] };
  }>;
}

// --- Clone Job Types ---

export type StageName = "backup" | "download" | "flash" | "inject";
export type StageStatus = "pending" | "in_progress" | "completed" | "failed";

export interface StageState {
  name: StageName;
  status: StageStatus;
  progress: number; // 0–100
}

export type JobStatus = "in_progress" | "completed" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  device: Device;
  stages: Record<StageName, StageState>;
  error: string | null;
  createdAt: number;
}

/** WebSocket messages (server → client) */
export type WsMessage =
  | { type: "stage_update"; stage: StageName; status: StageStatus; progress: number }
  | { type: "error"; stage: StageName; message: string }
  | { type: "done" }
  | { type: "cancelled" };

/** POST /api/start-clone request body */
export interface StartCloneRequest {
  device: string;
  backup_slug?: string;
}

/** Supervisor backup entry from GET /backups */
export interface SupervisorBackup {
  slug: string;
  name: string;
  date: string;
  type: "full" | "partial";
  size: number; // MB float from Supervisor
}

/** Supervisor backup creation response */
export interface BackupJobResponse {
  job_id: string;
}

/** Supervisor job poll response */
export interface SupervisorJobStatus {
  done: boolean;
  progress: number;
  reference: string | null;
  errors: string[];
}
