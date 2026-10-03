cat > server.js <<'EOF'
import express from "express";
import cors from "cors";
import crypto from "crypto";
import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
const sqlJsPackage = path.dirname(require.resolve("sql.js/package.json"));
const wasmPath = path.join(sqlJsPackage, "dist", "sql-wasm.wasm");

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

const dbFile = path.join(__dirname, "daddy-ji.db");

const SQL = await initSqlJs({
  locateFile: () => wasmPath
});

let db;

if (fs.existsSync(dbFile)) {
  const data = fs.readFileSync(dbFile);
  db = new SQL.Database(data);
  console.log("Existing database loaded.");
} else {
  db = new SQL.Database();
  console.log("New database created.");
}

db.run(`
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

function saveDatabase() {
  const data = db.export();
  fs.writeFileSync(dbFile, Buffer.from(data));
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);
    stmt.step();
  } finally {
    stmt.free();
  }

  saveDatabase();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params);

    if (stmt.step()) {
      return stmt.getAsObject();
    }

    return null;
  } finally {
    stmt.free();
  }
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  const rows = [];

  try {
    stmt.bind(params);

    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }

    return rows;
  } finally {
    stmt.free();
  }
}

saveDatabase();

/* =========================
   HEALTH
========================= */

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    database: {
      driver: "sql.js",
      connected: true,
      persistent: true
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
      driver: "sql.js",
      connected: true,
      persistent: true
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

  const cleanUsername = String(username).trim();
  const token = crypto.randomUUID();

  run(`
    INSERT INTO sessions (token, username, created_at)
    VALUES (?, ?, ?)
  `, [
    token,
    cleanUsername,
    new Date().toISOString()
  ]);

  res.json({
    token,
    username: cleanUsername
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

  return get(`
    SELECT token, username, created_at
    FROM sessions
    WHERE token = ?
  `, [header.slice(7)]);
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

  const id = String(device_id);
  const now = new Date().toISOString();

  const existing = get(`
    SELECT id FROM devices WHERE id = ?
  `, [id]);

  if (existing) {
    run(`
      UPDATE devices
      SET name = ?,
          model = ?,
          battery = ?,
          app_version = ?,
          status = 'online',
          last_seen = ?
      WHERE id = ?
    `, [
      model || "Android Device",
      model || "Unknown",
      battery != null ? Number(battery) : null,
      app_version || "unknown",
      now,
      id
    ]);
  } else {
    run(`
      INSERT INTO devices
        (id, name, model, battery, app_version, status, last_seen, created_at)
      VALUES
        (?, ?, ?, ?, ?, 'online', ?, ?)
    `, [
      id,
      model || "Android Device",
      model || "Unknown",
      battery != null ? Number(battery) : null,
      app_version || "unknown",
      now,
      now
    ]);
  }

  const device = get(`
    SELECT * FROM devices WHERE id = ?
  `, [id]);

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

  const exists = get(`
    SELECT id FROM devices WHERE id = ?
  `, [id]);

  if (!exists) {
    return res.status(404).json({
      error: "device not registered"
    });
  }

  const now = new Date().toISOString();

  if (req.body?.battery !== undefined) {
    run(`
      UPDATE devices
      SET battery = ?,
          status = 'online',
          last_seen = ?
      WHERE id = ?
    `, [
      Number(req.body.battery),
      now,
      id
    ]);
  } else {
    run(`
      UPDATE devices
      SET status = 'online',
          last_seen = ?
      WHERE id = ?
    `, [
      now,
      id
    ]);
  }

  const device = get(`
    SELECT * FROM devices WHERE id = ?
  `, [id]);

  res.json({
    ok: true,
    device
  });
});

/* =========================
   DEVICES
========================= */

app.get("/api/devices", (_req, res) => {
  const devices = all(`
    SELECT * FROM devices
    ORDER BY last_seen DESC
  `);

  res.json(devices);
});

/* =========================
   DEVICE SUMMARY
========================= */

app.get("/api/devices/summary", (_req, res) => {
  const totalRow = get(`
    SELECT COUNT(*) AS count FROM devices
  `);

  const onlineRow = get(`
    SELECT COUNT(*) AS count
    FROM devices
    WHERE status = 'online'
  `);

  const total = Number(totalRow?.count || 0);
  const online = Number(onlineRow?.count || 0);

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
  const device = get(`
    SELECT * FROM devices WHERE id = ?
  `, [String(req.params.id)]);

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
  const messages = all(`
    SELECT *
    FROM sms_logs
    ORDER BY created_at DESC
  `);

  res.json(messages);
});

/* =========================
   CHECKS
========================= */

app.get("/api/checks", (_req, res) => {
  const checks = all(`
    SELECT *
    FROM checks
    ORDER BY created_at DESC
  `);

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
  console.log(`Database: ${dbFile}`);
});
EOF
