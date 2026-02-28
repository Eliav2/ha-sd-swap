import { useEffect } from "react";
import type { WsMessage } from "@/types";
import { actions } from "@/store";

/**
 * Connect to the backend WebSocket for real-time clone progress.
 * Automatically reconnects on drop (e.g. addon restart) so the UI
 * always reflects the current server state.
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
    const wsUrl = `${wsProto}//${location.host}${base}ws/progress`;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        const msg: WsMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "stage_update":
            actions.updateStage(msg.stage, msg.status, msg.progress, msg.speed, msg.eta, msg.description);
            break;
          case "error":
            actions.updateStage(msg.stage, "failed", 0);
            break;
          case "done":
            actions.finishJob(msg.backupName);
            break;
          case "cancelled":
            actions.reset();
            break;
        }
      };

      ws.onclose = () => {
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [active]);
}
