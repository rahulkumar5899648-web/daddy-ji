import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const devices = [
  {
    id: "demo-001",
    name: "My Phone",
    status: "online",
    battery: 87,
    smsForwarding: false,
    callForwarding: false
  },
  {
    id: "demo-002",
    name: "Test Phone",
    status: "offline",
    battery: 42,
    smsForwarding: false,
    callForwarding: false
  }
];

const sms = [
  {
    id: 1,
    device_id: "demo-001",
    sender: "TEST",
    message: "Demo SMS message",
    time: new Date().toISOString()
  }
];

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, demo: true });
});

app.get("/api/devices", (_req, res) => {
  res.json(devices);
});

app.get("/api/devices/summary", (_req, res) => {
  res.json({
    total: devices.length,
    online: devices.filter(d => d.status === "online").length,
    offline: devices.filter(d => d.status === "offline").length
  });
});

app.get("/api/devices/:id", (req, res) => {
  const device = devices.find(d => d.id === req.params.id);

  if (!device) {
    return res.status(404).json({ error: "Device not found" });
  }

  res.json(device);
});

app.get("/api/sms", (_req, res) => {
  res.json(sms);
});

app.get("/api/forwarding-status", (_req, res) => {
  res.json({
    sms_forwarding: false,
    call_forwarding: false,
    demo: true
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Demo API running on port ${PORT}`);
});
