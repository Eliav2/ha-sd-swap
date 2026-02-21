import { Hono } from "hono";
import { listUsbDevices } from "./devices.ts";
import { getSystemInfo } from "./supervisor.ts";

const app = new Hono();

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

const PORT = 8080;

export default {
  port: PORT,
  fetch: app.fetch,
};

console.log(`SD Swap API server listening on port ${PORT}`);
