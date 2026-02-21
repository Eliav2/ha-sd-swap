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
}

/** Clone job stages */
export type StageName = "backup" | "download" | "flash" | "inject";

export type StageStatus = "pending" | "in_progress" | "completed" | "failed";

export interface StageState {
  name: StageName;
  label: string;
  status: StageStatus;
  progress: number; // 0–100
}

/** WebSocket messages (server → client) */
export type WsMessage =
  | { type: "stage_update"; stage: StageName; status: StageStatus; progress: number }
  | { type: "error"; stage: StageName; message: string }
  | { type: "done" };

/** App screens */
export type Screen = "device_select" | "confirm" | "progress" | "complete";

