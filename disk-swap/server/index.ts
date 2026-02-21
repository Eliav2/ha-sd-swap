import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const isDev = process.env.DEV === "1";

const { listUsbDevices } = isDev
  ? await import("./mock.ts")
  : await import("./devices.ts");

const { getSystemInfo } = isDev
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

const staticRoot = isDev ? "./rootfs/var/www" : "/var/www";
app.use("*", serveStatic({ root: staticRoot }));
app.get("*", serveStatic({ path: `${staticRoot}/index.html` }));

const PORT = Number(process.env.INGRESS_PORT) || 8099;

export default {
  port: PORT,
  fetch: app.fetch,
};

console.log(
  `SD Swap server listening on port ${PORT}${isDev ? " (dev mode)" : ""}`
);
