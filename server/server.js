"use strict";

// Serveur local AIS Tracker : sert le frontend statique, relaie le flux
// AISStream (une seule connexion, partagée par tous les onglets), gère
// l'enregistrement CSV/JSON et le rejeu à vitesse variable.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const { AisRelay } = require("./aisRelay");
const { Recorder } = require("./recorder");
const { ReplayEngine } = require("./replay");

const PORT = process.env.PORT || 8383;
const ROOT_DIR = path.join(__dirname, "..");

const aisRelay = new AisRelay();
const recorder = new Recorder(aisRelay);
const replay = new ReplayEngine(recorder);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((e) => sendJson(res, 500, { error: e.message }));
    return;
  }

  serveStatic(req, res, url.pathname);
});

// --- Fichiers statiques (frontend) ---

function serveStatic(req, res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT_DIR, rel));

  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

// --- API REST ---

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (req.method === "GET" && parts[1] === "status") {
    return sendJson(res, 200, {
      configured: aisRelay.isConfigured(),
      zone: aisRelay.getZone(),
      ais: aisRelay.getStatus(),
      recording: recorder.getStatus(),
      replay: replay.getStatus(),
    });
  }

  if (req.method === "POST" && parts[1] === "configure") {
    const body = await readJsonBody(req);
    if (!body.apiKey || !body.zone) return sendJson(res, 400, { error: "apiKey et zone requis" });
    aisRelay.configure(body.apiKey, body.zone);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && parts[1] === "zone") {
    const body = await readJsonBody(req);
    if (!body.zone) return sendJson(res, 400, { error: "zone requise" });
    aisRelay.setZone(body.zone);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && parts[1] === "disconnect") {
    aisRelay.disconnect();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && parts[1] === "recording" && parts[2] === "start") {
    const body = await readJsonBody(req);
    try {
      return sendJson(res, 200, recorder.start(body.format));
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && parts[1] === "recording" && parts[2] === "stop") {
    try {
      return sendJson(res, 200, recorder.stop());
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "GET" && parts[1] === "recordings" && !parts[2]) {
    return sendJson(res, 200, recorder.listRecordings());
  }

  if (req.method === "GET" && parts[1] === "recordings" && parts[3] === "download") {
    const filePath = recorder.getRecordingFilePath(parts[2]);
    if (!filePath || !fs.existsSync(filePath)) return sendJson(res, 404, { error: "Introuvable" });
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${path.basename(filePath)}"`,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (req.method === "DELETE" && parts[1] === "recordings" && parts[2]) {
    try {
      const ok = recorder.deleteRecording(parts[2]);
      return sendJson(res, ok ? 200 : 404, { ok });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && parts[1] === "replay" && parts[2] === "start") {
    const body = await readJsonBody(req);
    try {
      return sendJson(res, 200, replay.start(body.id, body.speed));
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && parts[1] === "replay" && parts[2] === "pause") {
    return sendJson(res, 200, replay.pause());
  }

  if (req.method === "POST" && parts[1] === "replay" && parts[2] === "resume") {
    return sendJson(res, 200, replay.resume());
  }

  if (req.method === "POST" && parts[1] === "replay" && parts[2] === "stop") {
    return sendJson(res, 200, replay.stop());
  }

  if (req.method === "POST" && parts[1] === "replay" && parts[2] === "speed") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, replay.setSpeed(body.speed));
  }

  sendJson(res, 404, { error: "Route inconnue" });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// --- WebSocket : diffusion en direct vers tous les onglets connectés ---

const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Set();

function broadcast(message) {
  const raw = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(raw);
  }
}

aisRelay.on("status", (status) => broadcast({ type: "status", ...status }));
aisRelay.on("data", (payload) => broadcast({ type: "data", payload }));
aisRelay.on("config", (config) => broadcast({ type: "config", ...config }));
recorder.on("status", (status) => broadcast({ type: "recording-status", ...status }));
replay.on("status", (status) => broadcast({ type: "replay-status", ...status }));
replay.on("data", (payload) => broadcast({ type: "replay-data", payload }));

wss.on("connection", (ws) => {
  clients.add(ws);

  ws.send(JSON.stringify({ type: "status", ...aisRelay.getStatus() }));
  ws.send(JSON.stringify({ type: "recording-status", ...recorder.getStatus() }));
  ws.send(JSON.stringify({ type: "replay-status", ...replay.getStatus() }));
  ws.send(
    JSON.stringify({
      type: "config",
      configured: aisRelay.isConfigured(),
      zone: aisRelay.getZone(),
    })
  );

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString("utf-8"));
    } catch {
      return;
    }

    switch (msg.type) {
      case "configure":
        aisRelay.configure(msg.apiKey, msg.zone);
        break;
      case "set-zone":
        aisRelay.setZone(msg.zone);
        break;
      case "disconnect":
        aisRelay.disconnect();
        break;
      case "connect":
        aisRelay.connect();
        break;
      default:
        break;
    }
  });

  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, () => {
  console.log(`AIS Tracker server listening on http://localhost:${PORT}`);
});
