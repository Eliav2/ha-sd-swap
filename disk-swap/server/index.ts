// Catch crashes that bypass try-catch
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[FATAL] Unhandled rejection:", err);
});

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { upgradeWebSocket, websocket } from "hono/bun";
import { getCurrentJob, subscribe } from "./jobs.ts";
import { runClonePipeline, cancelClone } from "./clone.ts";

const isDev = process.env.DEV === "1";

const { listUsbDevices } = isDev
  ? await import("./mock.ts")
  : await import("./devices.ts");

const { getSystemInfo, listBackups: listBackupsFn } = isDev
  ? await import("./mock.ts")
  : await import("./supervisor.ts");

const app = new Hono();

// HA ingress produces double-slash paths (ingress_entry: / appended to token/)
// Normalize before routing so /api/devices matches //api/devices
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.includes("//")) {
    url.pathname = url.pathname.replace(/\/\/+/g, "/");
    return app.fetch(new Request(url, c.req.raw), c.env);
  }
  return next();
});

// --- API routes ---

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("/api/devices", async (c) => {
  try {
    const devices = await listUsbDevices();
    return c.json({ devices });
  } catch (err) {
    console.error("Error listing devices:", err);
    return c.json(
      { error: "Failed to list devices", detail: String(err) },
      500,
    );
  }
});

app.get("/api/system-info", async (c) => {
  try {
    const info = await getSystemInfo();
    return c.json(info);
  } catch (err) {
    console.error("Error fetching system info:", err);
    return c.json(
      { error: "Failed to fetch system info", detail: String(err) },
      500,
    );
  }
});

// --- Backups API ---

app.get("/api/backups", async (c) => {
  try {
    const backups = await listBackupsFn();
    return c.json({ backups });
  } catch (err) {
    console.error("Error listing backups:", err);
    return c.json(
      { error: "Failed to list backups", detail: String(err) },
      500,
    );
  }
});

// --- Clone API ---

app.post("/api/start-clone", async (c) => {
  try {
    const body = await c.req.json<{ device: string; backup_slug?: string }>();
    if (!body.device) {
      return c.json({ error: "Missing 'device' field" }, 400);
    }

    const job = await runClonePipeline(body.device, body.backup_slug);
    return c.json({ job_id: job.id });
  } catch (err) {
    console.error("Start clone failed:", err);
    return c.json({ error: String(err) }, 400);
  }
});

app.post("/api/cancel-clone", (c) => {
  cancelClone();
  return c.json({ ok: true });
});

app.get("/api/jobs/current", (c) => {
  const job = getCurrentJob();
  if (!job) {
    return c.json({ error: "No active job" }, 404);
  }
  return c.json(job);
});

// --- WebSocket for real-time progress ---

app.get(
  "/ws/progress",
  upgradeWebSocket(() => {
    let unsubscribe: (() => void) | null = null;

    return {
      onOpen(_event, ws) {
        // Send current job snapshot for reconnection
        const job = getCurrentJob();
        if (job) {
          for (const stage of Object.values(job.stages)) {
            ws.send(
              JSON.stringify({
                type: "stage_update",
                stage: stage.name,
                status: stage.status,
                progress: stage.progress,
              }),
            );
          }
          if (job.status === "completed") {
            ws.send(JSON.stringify({ type: "done" }));
          } else if (job.status === "failed" && job.error) {
            const failedStage = Object.values(job.stages).find(
              (s) => s.status === "failed",
            );
            ws.send(
              JSON.stringify({
                type: "error",
                stage: failedStage?.name || "backup",
                message: job.error,
              }),
            );
          }
        }

        // Subscribe to future updates
        unsubscribe = subscribe((msg) => {
          try {
            ws.send(JSON.stringify(msg));
          } catch {
            /* client disconnected */
          }
        });
      },
      onClose() {
        unsubscribe?.();
      },
    };
  }),
);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// --- Static files (web UI) ---

const staticRoot = isDev ? "./rootfs/var/www" : "/var/www";
app.use("*", serveStatic({ root: staticRoot }));
app.get("*", serveStatic({ path: `${staticRoot}/index.html` }));

const PORT = Number(process.env.INGRESS_PORT) || 8099;

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};

console.log(
  `Disk Swap server listening on port ${PORT}${isDev ? " (dev mode)" : ""}`,
);
