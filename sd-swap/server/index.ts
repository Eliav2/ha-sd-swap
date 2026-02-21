import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { listUsbDevices } from "./devices.ts";
import { getSystemInfo } from "./supervisor.ts";

const app = new Hono();

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
      500
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
      500
    );
  }
});

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// --- Static files (web UI) ---

app.use("*", serveStatic({ root: "/var/www" }));
// SPA fallback: serve index.html for any unmatched route
app.get("*", serveStatic({ path: "/var/www/index.html" }));

const PORT = Number(process.env.INGRESS_PORT) || 8099;

export default {
  port: PORT,
  fetch: app.fetch,
};

console.log(`SD Swap server listening on port ${PORT}`);
