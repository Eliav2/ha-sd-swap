import { useReducer } from "react";
import type { AppState, AppAction, StageState } from "@/types";
import { useCloneProgress } from "@/hooks/use-clone-progress";
import { DeviceList } from "@/components/DeviceList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CloneProgress } from "@/components/CloneProgress";
import { SwapComplete } from "@/components/SwapComplete";

const initialStages: StageState[] = [
  { name: "download", label: "Download HA OS image", status: "pending", progress: 0 },
  { name: "flash", label: "Flash to device", status: "pending", progress: 0 },
  { name: "verify", label: "Verify written data", status: "pending", progress: 0 },
  { name: "migrate", label: "Migrate configuration", status: "pending", progress: 0 },
];

const initialState: AppState = {
  screen: "device_select",
  selectedDevice: null,
  stages: initialStages,
};

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SELECT_DEVICE":
      return { ...state, screen: "confirm", selectedDevice: action.device };
    case "CONFIRM":
      return { ...state, screen: "progress", stages: initialStages.map((s) => ({ ...s })) };
    case "CANCEL":
      return { ...state, screen: "device_select", selectedDevice: null };
    case "UPDATE_STAGE":
      return {
        ...state,
        stages: state.stages.map((s) =>
          s.name === action.stageName
            ? { ...s, status: action.status, progress: action.progress }
            : s
        ),
      };
    case "COMPLETE":
      return { ...state, screen: "complete" };
    case "FAIL":
      return {
        ...state,
        stages: state.stages.map((s) =>
          s.name === action.stageName ? { ...s, status: "failed" } : s
        ),
      };
    case "RESET":
      return { ...initialState, stages: initialStages.map((s) => ({ ...s })) };
    default:
      return state;
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  useCloneProgress(state.screen === "progress", dispatch);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {state.screen === "device_select" && (
        <DeviceList onSelect={(device) => dispatch({ type: "SELECT_DEVICE", device })} />
      )}

      {state.screen === "confirm" && state.selectedDevice && (
        <ConfirmDialog
          device={state.selectedDevice}
          onConfirm={() => dispatch({ type: "CONFIRM" })}
          onCancel={() => dispatch({ type: "CANCEL" })}
        />
      )}

      {state.screen === "progress" && state.selectedDevice && (
        <CloneProgress device={state.selectedDevice} stages={state.stages} />
      )}

      {state.screen === "complete" && state.selectedDevice && (
        <SwapComplete
          device={state.selectedDevice}
          onReset={() => dispatch({ type: "RESET" })}
        />
      )}
    </div>
  );
}
