import { useEffect } from "react";
import type { WsMessage } from "@/types";
import { actions } from "@/store";

/**
 * Connect to the backend WebSocket for real-time clone progress.
 * Dispatches stage updates to the TanStack Store.
 */
export function useCloneProgress(active: boolean) {
  useEffect(() => {
    if (!active) return;

    // Derive WebSocket URL relative to the page (works with HA ingress)
    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const rawBase = location.pathname.endsWith("/")
      ? location.pathname
      : location.pathname + "/";
    // Normalize double slashes from HA ingress (ingress_entry: / produces //)
    // Must be done client-side because the server's re-fetch normalization
    // loses the TCP connection needed for WebSocket upgrade
    const base = rawBase.replace(/\/\/+/g, "/");
    const ws = new WebSocket(`${wsProto}//${location.host}${base}ws/progress`);

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);
      switch (msg.type) {
        case "stage_update":
          actions.updateStage(msg.stage, msg.status, msg.progress);
          break;
        case "error":
          actions.updateStage(msg.stage, "failed", 0);
          break;
        case "done":
          actions.complete();
          break;
      }
    };

    return () => {
      ws.close();
    };
  }, [active]);
}
