/** Filtered, safe USB device returned by GET api/devices */
export interface Device {
  name: string;
  path: string;
  size: number;
  size_human: string;
  vendor: string;
  model: string;
  tran: string;
  serial: string;
  has_ha_os: boolean;
}

/** Response shape for GET api/devices */
export interface DevicesResponse {
  devices: Device[];
}

/** Response shape for GET api/system-info */
export interface SystemInfoResponse {
  machine: string;
  board_slug: string;
  os_version: string;
  os_version_latest: string;
  ip_address: string;
  free_space_bytes: number;
  free_space_human: string;
  protected: boolean;
  addon_slug: string;
}

/** HA backup entry from GET api/backups */
export interface Backup {
  slug: string;
  name: string;
  date: string;
  type: "full" | "partial";
  size: number; // MB float
}

/** Response shape for GET api/backups */
export interface BackupsResponse {
  backups: Backup[];
}

/** User's backup choice for the clone pipeline */
export type BackupSelection =
  | { type: "new" }
  | { type: "existing"; slug: string; name: string };

/** Response shape for GET api/image-cache */
export interface ImageCacheStatus {
  cached: boolean;
  version?: string;
  board?: string;
  size_bytes?: number;
  size_human?: string;
}

/** Clone job stages */
export type StageName = "backup" | "download" | "flash" | "inject";

export type StageStatus = "pending" | "in_progress" | "completed" | "failed";

export interface StageState {
  name: StageName;
  label: string;
  description: string;
  status: StageStatus;
  progress: number; // 0–100
  speed?: number; // bytes/sec
  eta?: number; // seconds remaining
  link?: { text: string; url: string };
}

/** WebSocket messages (server → client) */
export type WsMessage =
  | { type: "stage_update"; stage: StageName; status: StageStatus; progress: number; speed?: number; eta?: number }
  | { type: "error"; stage: StageName; message: string }
  | { type: "done" }
  | { type: "cancelled" };

/** Job status */
export type JobStatus = "in_progress" | "completed" | "failed";

/** Clone job returned by GET api/jobs/current */
export interface Job {
  id: string;
  status: JobStatus;
  device: Device;
  stages: Record<StageName, { name: StageName; status: StageStatus; progress: number }>;
  error: string | null;
  createdAt: number;
}

/** App screens */
export type Screen = "device_select" | "backup_select" | "confirm" | "progress" | "complete";
