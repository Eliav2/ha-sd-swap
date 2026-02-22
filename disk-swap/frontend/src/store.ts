import { Store } from "@tanstack/react-store";
import type { BackupSelection, Device, ImageCacheStatus, Job, Screen, StageState, SystemInfoResponse } from "@/types";

export interface AppState {
  screen: Screen;
  selectedDevice: Device | null;
  selectedBackup: BackupSelection | null;
  stages: StageState[];
}

const defaultStages: StageState[] = [
  { name: "backup", label: "Backup", description: "", status: "pending", progress: 0 },
  { name: "download", label: "Download HA OS image", description: "", status: "pending", progress: 0 },
  { name: "flash", label: "Flash to device", description: "", status: "pending", progress: 0 },
  { name: "inject", label: "Inject backup", description: "", status: "pending", progress: 0 },
];

export const appStore = new Store<AppState>({
  screen: "device_select",
  selectedDevice: null,
  selectedBackup: null,
  stages: defaultStages,
});

/** Build stages with dynamic descriptions based on user selections and system info. */
function buildStages(
  backup: BackupSelection,
  systemInfo?: SystemInfoResponse | null,
  imageCache?: ImageCacheStatus | null,
): StageState[] {
  const version = systemInfo?.os_version ?? "latest";
  const board = systemInfo?.board_slug ?? "your device";
  const releaseUrl = `https://github.com/home-assistant/operating-system/releases/tag/${version}`;
  const isCached = imageCache?.cached === true;

  const downloadDesc = isCached
    ? `Using cached HA OS ${version} image for ${board}.`
    : `Downloads HA OS ${version} for ${board}.`;

  return [
    {
      name: "backup",
      label: "Backup",
      description: backup.type === "new"
        ? "Creates a full backup of your HA configuration, apps, and database."
        : `Using existing backup "${backup.name}".`,
      status: "pending",
      progress: 0,
    },
    {
      name: "download",
      label: isCached ? "Download HA OS image (cached)" : "Download HA OS image",
      description: downloadDesc,
      link: { text: "View release", url: releaseUrl },
      status: "pending",
      progress: 0,
    },
    {
      name: "flash",
      label: "Flash to device",
      description: "Writes the OS image to the target USB device.",
      status: "pending",
      progress: 0,
    },
    {
      name: "inject",
      label: "Inject backup",
      description: "Copies backup to the new device for automatic restore on first boot.",
      status: "pending",
      progress: 0,
    },
  ];
}

export const actions = {
  selectDevice(device: Device) {
    appStore.setState((s) => ({ ...s, selectedDevice: device }));
  },

  next() {
    appStore.setState((s) => ({ ...s, screen: "confirm" as const }));
  },

  /** After the erase warning, go to backup selection. */
  confirmErase() {
    appStore.setState((s) => ({ ...s, screen: "backup_select" as const }));
  },

  selectBackup(backup: BackupSelection) {
    appStore.setState((s) => ({ ...s, selectedBackup: backup }));
  },

  /** Start the pipeline after backup is selected. */
  startClone(systemInfo?: SystemInfoResponse | null, imageCache?: ImageCacheStatus | null) {
    appStore.setState((s) => {
      const backup = s.selectedBackup ?? { type: "new" as const };
      return {
        ...s,
        screen: "progress" as const,
        stages: buildStages(backup, systemInfo, imageCache),
      };
    });
  },

  cancel() {
    appStore.setState((s) => ({
      ...s,
      screen: "device_select" as const,
      selectedDevice: null,
      selectedBackup: null,
    }));
  },

  /** Go back from backup_select to confirm (device selection). */
  backToDeviceSelect() {
    appStore.setState((s) => ({
      ...s,
      screen: "device_select" as const,
      selectedBackup: null,
    }));
  },

  updateStage(stageName: string, status: StageState["status"], progress: number, speed?: number, eta?: number) {
    appStore.setState((s) => ({
      ...s,
      stages: s.stages.map((st) =>
        st.name === stageName ? { ...st, status, progress, speed, eta } : st
      ),
    }));
  },

  complete() {
    appStore.setState((s) => ({ ...s, screen: "complete" as const }));
  },

  resumeJob(job: Job) {
    const screen: Screen =
      job.status === "completed" ? "complete" : "progress";

    const stages: StageState[] = defaultStages.map((init) => {
      const jobStage = job.stages[init.name];
      return {
        ...init,
        status: jobStage?.status ?? "pending",
        progress: jobStage?.progress ?? 0,
      };
    });

    appStore.setState(() => ({
      screen,
      selectedDevice: job.device,
      selectedBackup: null,
      stages,
    }));
  },

  reset() {
    appStore.setState(() => ({
      screen: "device_select" as const,
      selectedDevice: null,
      selectedBackup: null,
      stages: defaultStages.map((st) => ({ ...st })),
    }));
  },
};
