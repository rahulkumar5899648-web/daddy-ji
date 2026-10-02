import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({
  origin: true,
  credentials: false
}));

app.use(express.json());

/* =========================
   IN-MEMORY DATA
========================= */

const devices = new Map();
const sessions = new Map();

/* =========================
   HEALTH
========================= */

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    database: {
      driver: "memory"
    },
    fcm: {
      configured: false
    }
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    database: {
      driver: "memory"
    },
    fcm: {
      configured: false
    }
  });
});

/* =========================
   LOGIN
========================= */

app.post("/api/customer/login", (req, res) => {
  const { username, passcode } = req.body || {};

  if (
    String(username || "").trim() !==
      String(process.env.PANEL_USERNAME || "").trim() ||
    String(passcode || "") !==
      String(process.env.PANEL_PASSCODE || "")
  ) {
    return res.status(401).json({
      error: {
        code: "INVALID_LOGIN",
        message: "Invalid username or password"
      }
    });
  }

  const token = crypto.randomUUID();

  sessions.set(token, {
    username: String(username).trim(),
    created_at: new Date().toISOString()
  });

  res.json({
    token,
    username: String(username).trim()
  });
});

/* =========================
   AUTH CHECK
========================= */

function getSession(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7);
  return sessions.get(token) || null;
}

/* =========================
   CUSTOMER INFO
========================= */

app.get("/api/customer/me", (req, res) => {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid session"
      }
    });
  }

  res.json({
    username: session.username
  });
});

/* =========================
   DEVICE REGISTER
========================= */

app.post("/api/devices/register", (req, res) => {
  const {
    device_id,
    model,
    battery,
    app_version
  } = req.body || {};

  if (!device_id) {
    return res.status(400).json({
      error: "device_id required"
    });
  }

  const device = {
    id: String(device_id),
    name: model || "Android Device",
    model: model || "Unknown",
    battery:
      battery !== undefined && battery !== null
        ? Number(battery)
        : null,
    app_version: app_version || "unknown",
    status: "online",
    last_seen: new Date().toISOString()
  };

  devices.set(String(device_id), device);

  res.json({
    ok: true,
    device
  });
});

/* =========================
   DEVICE HEARTBEAT
========================= */

app.post("/api/devices/:id/heartbeat", (req, res) => {
  const id = String(req.params.id);
  const device = devices.get(id);

  if (!device) {
    return res.status(404).json({
      error: "device not registered"
    });
  }

  if (req.body && req.body.battery !== undefined) {
    device.battery = Number(req.body.battery);
  }

  device.status = "online";
  device.last_seen = new Date().toISOString();

  devices.set(id, device);

  res.json({
    ok: true,
    device
  });
});

/* =========================
   DEVICE LIST
========================= */

app.get("/api/devices", (_req, res) => {
  res.json([...devices.values()]);
});

/* =========================
   DEVICE SUMMARY
========================= */

app.get("/api/devices/summary", (_req, res) => {
  const list = [...devices.values()];

  res.json({
    total: list.length,
    online: list.filter(d => d.status === "online").length,
    offline: list.filter(d => d.status !== "online").length
  });
});

/* =========================
   SINGLE DEVICE
========================= */

app.get("/api/devices/:id", (req, res) => {
  const device = devices.get(String(req.params.id));

  if (!device) {
    return res.status(404).json({
      error: "Device not found"
    });
  }

  res.json(device);
});

/* =========================
   DEMO SMS LIST
========================= */

app.get("/api/sms", (_req, res) => {
  res.json([]);
});

/* =========================
   FEATURES
========================= */

app.get("/api/features", (_req, res) => {
  res.json({
    telemetry: true,
    sms: false,
    call_forwarding: false,
    ussd: false,
    remote_control: false
  });
});

/* =========================
   LIVE EVENTS
========================= */

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(
    `data: ${JSON.stringify({
      type: "connected",
      time: new Date().toISOString()
    })}\n\n`
  );

  const timer = setInterval(() => {
    res.write(
      `data: ${JSON.stringify({
        type: "heartbeat",
        time: new Date().toISOString()
      })}\n\n`
    );
  }, 30000);

  req.on("close", () => {
    clearInterval(timer);
  });
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
