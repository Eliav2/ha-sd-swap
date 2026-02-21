import { Store } from "@tanstack/react-store";
import type { Device, Job, Screen, StageState } from "@/types";

export interface AppState {
  screen: Screen;
  selectedDevice: Device | null;
  stages: StageState[];
}

const initialStages: StageState[] = [
  { name: "backup", label: "Create backup", status: "pending", progress: 0 },
  { name: "download", label: "Download HA OS image", status: "pending", progress: 0 },
  { name: "flash", label: "Flash to device", status: "pending", progress: 0 },
  { name: "inject", label: "Inject backup", status: "pending", progress: 0 },
];

export const appStore = new Store<AppState>({
  screen: "device_select",
  selectedDevice: null,
  stages: initialStages,
});

export const actions = {
  selectDevice(device: Device) {
    appStore.setState((s) => ({ ...s, selectedDevice: device }));
  },

  next() {
    appStore.setState((s) => ({ ...s, screen: "confirm" as const }));
  },

  confirm() {
    appStore.setState((s) => ({
      ...s,
      screen: "progress" as const,
      stages: initialStages.map((st) => ({ ...st })),
    }));
  },

  cancel() {
    appStore.setState((s) => ({
      ...s,
      screen: "device_select" as const,
      selectedDevice: null,
    }));
  },

  updateStage(stageName: string, status: StageState["status"], progress: number) {
    appStore.setState((s) => ({
      ...s,
      stages: s.stages.map((st) =>
        st.name === stageName ? { ...st, status, progress } : st
      ),
    }));
  },

  complete() {
    appStore.setState((s) => ({ ...s, screen: "complete" as const }));
  },

  resumeJob(job: Job) {
    const screen: Screen =
      job.status === "completed" ? "complete" : "progress";

    const stages: StageState[] = initialStages.map((init) => {
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
      stages,
    }));
  },

  reset() {
    appStore.setState(() => ({
      screen: "device_select" as const,
      selectedDevice: null,
      stages: initialStages.map((st) => ({ ...st })),
    }));
  },
};
