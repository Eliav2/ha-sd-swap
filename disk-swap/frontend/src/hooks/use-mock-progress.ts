import { useEffect, useRef } from "react";
import type { StageName } from "@/types";
import { actions } from "@/store";

const STAGE_ORDER: StageName[] = ["download", "flash", "verify", "migrate"];

/**
 * Mock clone progress via timers.
 * Later this will be replaced by a WebSocket connection.
 */
export function useMockProgress(active: boolean) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stageIndexRef = useRef(0);
  const progressRef = useRef(0);

  useEffect(() => {
    if (!active) {
      stageIndexRef.current = 0;
      progressRef.current = 0;
      return;
    }

    actions.updateStage(STAGE_ORDER[0], "in_progress", 0);

    intervalRef.current = setInterval(() => {
      const idx = stageIndexRef.current;
      if (idx >= STAGE_ORDER.length) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        actions.complete();
        return;
      }

      progressRef.current += Math.random() * 15 + 5;

      if (progressRef.current >= 100) {
        actions.updateStage(STAGE_ORDER[idx], "completed", 100);

        stageIndexRef.current = idx + 1;
        progressRef.current = 0;

        if (idx + 1 < STAGE_ORDER.length) {
          actions.updateStage(STAGE_ORDER[idx + 1], "in_progress", 0);
        }
      } else {
        actions.updateStage(STAGE_ORDER[idx], "in_progress", Math.round(progressRef.current));
      }
    }, 400);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active]);
}
