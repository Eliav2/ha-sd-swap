import { useEffect, useRef } from "react";
import type { AppAction, StageName } from "@/types";

const STAGE_ORDER: StageName[] = ["download", "flash", "verify", "migrate"];

/**
 * Mock clone progress via timers.
 * Later this will be replaced by a WebSocket connection.
 */
export function useCloneProgress(
  active: boolean,
  dispatch: React.Dispatch<AppAction>
) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stageIndexRef = useRef(0);
  const progressRef = useRef(0);

  useEffect(() => {
    if (!active) {
      stageIndexRef.current = 0;
      progressRef.current = 0;
      return;
    }

    // Start first stage
    dispatch({
      type: "UPDATE_STAGE",
      stageName: STAGE_ORDER[0],
      status: "in_progress",
      progress: 0,
    });

    intervalRef.current = setInterval(() => {
      const idx = stageIndexRef.current;
      if (idx >= STAGE_ORDER.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        dispatch({ type: "COMPLETE" });
        return;
      }

      progressRef.current += Math.random() * 15 + 5;

      if (progressRef.current >= 100) {
        dispatch({
          type: "UPDATE_STAGE",
          stageName: STAGE_ORDER[idx],
          status: "completed",
          progress: 100,
        });

        stageIndexRef.current = idx + 1;
        progressRef.current = 0;

        if (idx + 1 < STAGE_ORDER.length) {
          dispatch({
            type: "UPDATE_STAGE",
            stageName: STAGE_ORDER[idx + 1],
            status: "in_progress",
            progress: 0,
          });
        }
      } else {
        dispatch({
          type: "UPDATE_STAGE",
          stageName: STAGE_ORDER[idx],
          status: "in_progress",
          progress: Math.round(progressRef.current),
        });
      }
    }, 400);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, dispatch]);
}
