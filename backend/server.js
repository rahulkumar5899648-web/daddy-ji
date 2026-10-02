import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const devices = new Map();

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Phone first-time registration
app.post("/api/devices/register", (req, res) => {
  const { device_id, model, battery, app_version } = req.body;

  if (!device_id) {
    return res.status(400).json({ error: "device_id required" });
  }

  const device = {
    id: device_id,
    model: model || "Unknown",
    battery: Number.isFinite(battery) ? battery : null,
    app_version: app_version || "unknown",
    status: "online",
    last_seen: new Date().toISOString()
  };

  devices.set(device_id, device);

  res.json({
    ok: true,
    device
  });
});

// Phone heartbeat
app.post("/api/devices/:id/heartbeat", (req, res) => {
  const device = devices.get(req.params.id);

  if (!device) {
    return res.status(404).json({ error: "device not registered" });
  }

  if (req.body.battery !== undefined) {
    device.battery = Number(req.body.battery);
  }

  device.status = "online";
  device.last_seen = new Date().toISOString();

  res.json({ ok: true });
});

// Panel device list
app.get("/api/devices", (_req, res) => {
  res.json([...devices.values()]);
});

// Panel summary
app.get("/api/devices/summary", (_req, res) => {
  const list = [...devices.values()];

  res.json({
    total: list.length,
    online: list.filter(x => x.status === "online").length,
    offline: list.filter(x => x.status !== "online").length
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API running on ${PORT}`);
});
