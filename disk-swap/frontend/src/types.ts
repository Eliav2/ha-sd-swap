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
export type StageName = "download" | "flash" | "verify" | "migrate";

export type StageStatus = "pending" | "in_progress" | "completed" | "failed";

export interface StageState {
  name: StageName;
  label: string;
  status: StageStatus;
  progress: number; // 0–100
}

/** App screens */
export type Screen = "device_select" | "confirm" | "progress" | "complete";

/** App-level state */
export interface AppState {
  screen: Screen;
  selectedDevice: Device | null;
  stages: StageState[];
}

export type AppAction =
  | { type: "SELECT_DEVICE"; device: Device }
  | { type: "CONFIRM" }
  | { type: "CANCEL" }
  | { type: "UPDATE_STAGE"; stageName: StageName; status: StageStatus; progress: number }
  | { type: "COMPLETE" }
  | { type: "FAIL"; stageName: StageName }
  | { type: "RESET" };
