"use strict";

// Rejoue un enregistrement (CSV ou JSON) en respectant le rythme original
// des messages, à une vitesse réglable (x1 à x20), avec play/pause/stop.

const fs = require("fs");
const EventEmitter = require("events");

const MIN_SPEED = 1;
const MAX_SPEED = 20;

class ReplayEngine extends EventEmitter {
  constructor(recorder) {
    super();
    this.recorder = recorder;
    this.state = "idle"; // idle | playing | paused
    this.recordingId = null;
    this.speed = 1;
    this.entries = [];
    this.index = 0;
    this.timer = null;
  }

  getStatus() {
    return {
      state: this.state,
      recordingId: this.recordingId,
      speed: this.speed,
      index: this.index,
      total: this.entries.length,
      currentTimestamp: this.entries[this.index - 1]?.t ?? null,
    };
  }

  start(recordingId, speed) {
    const meta = this.recorder.getRecordingMeta(recordingId);
    if (!meta) throw new Error("Enregistrement introuvable.");

    this.entries = loadEntries(this.recorder.getRecordingFilePath(recordingId), meta.format);
    if (this.entries.length === 0) throw new Error("Enregistrement vide.");

    this.recordingId = recordingId;
    this.speed = clampSpeed(speed);
    this.index = 0;
    this.state = "playing";
    this._emitStatus();
    this._step();
    return this.getStatus();
  }

  pause() {
    if (this.state !== "playing") return this.getStatus();
    this.state = "paused";
    clearTimeout(this.timer);
    this._emitStatus();
    return this.getStatus();
  }

  resume() {
    if (this.state !== "paused") return this.getStatus();
    this.state = "playing";
    this._emitStatus();
    this._step();
    return this.getStatus();
  }

  stop() {
    clearTimeout(this.timer);
    this.state = "idle";
    this.recordingId = null;
    this.entries = [];
    this.index = 0;
    this._emitStatus();
    return this.getStatus();
  }

  setSpeed(speed) {
    this.speed = clampSpeed(speed);
    this._emitStatus();
    return this.getStatus();
  }

  _step() {
    if (this.state !== "playing") return;
    if (this.index >= this.entries.length) {
      this.stop();
      return;
    }

    const entry = this.entries[this.index];
    this.emit("data", entry.data);
    this.index++;
    this._emitStatus();

    if (this.index >= this.entries.length) {
      this.stop();
      return;
    }

    const delay = Math.max(0, this.entries[this.index].t - entry.t) / this.speed;
    this.timer = setTimeout(() => this._step(), delay);
  }

  _emitStatus() {
    this.emit("status", this.getStatus());
  }
}

function clampSpeed(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
}

function loadEntries(filePath, format) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return format === "csv" ? parseCsvEntries(raw) : parseJsonEntries(raw);
}

function parseJsonEntries(raw) {
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function parseCsvEntries(raw) {
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const rawJsonIndex = header.indexOf("raw_json");
  const receivedAtIndex = header.indexOf("receivedAtMs");

  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length <= rawJsonIndex) continue;
    try {
      entries.push({
        t: Number(fields[receivedAtIndex]),
        data: JSON.parse(fields[rawJsonIndex]),
      });
    } catch {
      // ligne corrompue, ignorée
    }
  }
  return entries;
}

// Parseur CSV mono-ligne (les champs générés par le recorder n'ont jamais de
// retour à la ligne brut, JSON.stringify les échappe déjà en "\n").
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

module.exports = { ReplayEngine };
