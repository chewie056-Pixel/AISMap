"use strict";

// Enregistrement du flux AIS relayé par aisRelay, en CSV ou JSON, sur disque
// côté serveur (indépendant du navigateur).

const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

const RECORDINGS_DIR = path.join(__dirname, "recordings");

const CSV_COLUMNS = [
  "receivedAtIso",
  "receivedAtMs",
  "messageType",
  "mmsi",
  "lat",
  "lon",
  "sog",
  "cog",
  "heading",
  "navStatus",
  "shipName",
  "shipType",
  "raw_json",
];

class Recorder extends EventEmitter {
  constructor(aisRelay) {
    super();
    this.aisRelay = aisRelay;
    this.state = "idle"; // idle | recording
    this.format = null;
    this.id = null;
    this.stream = null;
    this.startedAt = null;
    this.messageCount = 0;
    this._onData = this._onData.bind(this);

    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    this._repairIncompleteRecordings();
  }

  getStatus() {
    return {
      state: this.state,
      format: this.format,
      id: this.id,
      startedAt: this.startedAt,
      messageCount: this.messageCount,
    };
  }

  start(format) {
    if (this.state === "recording") {
      throw new Error("Un enregistrement est déjà en cours.");
    }
    if (format !== "csv" && format !== "json") {
      throw new Error("Format invalide : 'csv' ou 'json' attendu.");
    }

    const startedAt = Date.now();
    const id = "rec_" + isoStamp(startedAt);
    const dataPath = path.join(RECORDINGS_DIR, `${id}.${format}`);

    this.format = format;
    this.id = id;
    this.startedAt = startedAt;
    this.messageCount = 0;
    this.state = "recording";
    this.stream = fs.createWriteStream(dataPath, { flags: "a" });

    if (format === "csv") {
      this.stream.write(CSV_COLUMNS.join(",") + "\n");
    } else {
      this.stream.write("[\n");
    }

    this._writeMeta({ complete: false, endedAt: null });
    this.aisRelay.on("data", this._onData);
    this._emitStatus();
    return this.getStatus();
  }

  stop() {
    if (this.state !== "recording") {
      throw new Error("Aucun enregistrement en cours.");
    }
    this.aisRelay.off("data", this._onData);

    if (this.format === "json") {
      this.stream.write("\n]\n");
    }
    this.stream.end();

    this._writeMeta({ complete: true, endedAt: Date.now() });

    this.state = "idle";
    const finished = { id: this.id, format: this.format, messageCount: this.messageCount };
    this.format = null;
    this.id = null;
    this.stream = null;
    this.startedAt = null;
    this.messageCount = 0;
    this._emitStatus();
    return finished;
  }

  _onData(data) {
    const receivedAtMs = Date.now();
    if (this.messageCount > 0) {
      this.stream.write(this.format === "json" ? ",\n" : "");
    }
    if (this.format === "json") {
      this.stream.write(JSON.stringify({ t: receivedAtMs, data }));
    } else {
      this.stream.write(csvRow(receivedAtMs, data) + "\n");
    }
    this.messageCount++;

    // Évite de réécrire les métadonnées à chaque message : throttlé.
    if (this.messageCount % 25 === 0) {
      this._writeMeta({ complete: false, endedAt: null });
      this._emitStatus();
    }
  }

  _writeMeta(extra) {
    writeMetaFile(this.id, this.format, this.startedAt, this.messageCount, extra);
  }

  _emitStatus() {
    this.emit("status", this.getStatus());
  }

  listRecordings() {
    const files = fs.readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith(".meta.json"));
    const items = files
      .map((f) => {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(RECORDINGS_DIR, f), "utf-8"));
          const dataPath = path.join(RECORDINGS_DIR, `${meta.id}.${meta.format}`);
          const sizeBytes = fs.existsSync(dataPath) ? fs.statSync(dataPath).size : 0;
          return { ...meta, sizeBytes };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    items.sort((a, b) => b.startedAt - a.startedAt);
    return items;
  }

  getRecordingMeta(id) {
    const metaPath = path.join(RECORDINGS_DIR, `${id}.meta.json`);
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  }

  getRecordingFilePath(id) {
    const meta = this.getRecordingMeta(id);
    if (!meta) return null;
    return path.join(RECORDINGS_DIR, `${id}.${meta.format}`);
  }

  deleteRecording(id) {
    if (this.state === "recording" && this.id === id) {
      throw new Error("Impossible de supprimer un enregistrement en cours.");
    }
    const meta = this.getRecordingMeta(id);
    if (!meta) return false;
    for (const ext of [meta.format, "meta.json"]) {
      const p = path.join(RECORDINGS_DIR, `${id}.${ext}`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    return true;
  }

  // Si le serveur a été arrêté brutalement pendant un enregistrement, le
  // fichier JSON n'a pas sa parenthèse fermante : on la rajoute pour que le
  // fichier reste exploitable (téléchargement, rejeu).
  _repairIncompleteRecordings() {
    for (const item of this.listRecordings()) {
      if (item.complete) continue;
      const dataPath = path.join(RECORDINGS_DIR, `${item.id}.${item.format}`);
      if (item.format === "json" && fs.existsSync(dataPath)) {
        try {
          fs.appendFileSync(dataPath, "\n]\n");
        } catch (e) {
          console.warn("Recorder: échec de réparation de", dataPath, e.message);
        }
      }
      writeMetaFile(item.id, item.format, item.startedAt, item.messageCount, {
        complete: true,
        endedAt: item.startedAt,
      });
    }
  }
}

function writeMetaFile(id, format, startedAt, messageCount, extra) {
  const metaPath = path.join(RECORDINGS_DIR, `${id}.meta.json`);
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ id, format, startedAt, messageCount, ...extra }, null, 2)
  );
}

function isoStamp(ms) {
  return new Date(ms).toISOString().replace(/[:.]/g, "-");
}

function csvField(value) {
  if (value === undefined || value === null) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Extrait quelques champs usuels (position, identifiants) pour les colonnes
// CSV ; la colonne raw_json conserve toujours le message complet.
function csvRow(receivedAtMs, data) {
  const meta = data.MetaData || {};
  const msg = data.Message || {};
  const report =
    msg.PositionReport ||
    msg.StandardClassBPositionReport ||
    msg.ExtendedClassBPositionReport ||
    msg.BaseStationReport ||
    msg.AidsToNavigationReport ||
    {};

  const fields = {
    receivedAtIso: new Date(receivedAtMs).toISOString(),
    receivedAtMs,
    messageType: data.MessageType || "",
    mmsi: meta.MMSI ?? meta.Mmsi ?? report.UserID ?? "",
    lat: meta.latitude ?? meta.Latitude ?? report.Latitude ?? "",
    lon: meta.longitude ?? meta.Longitude ?? report.Longitude ?? "",
    sog: report.Sog ?? "",
    cog: report.Cog ?? "",
    heading: report.TrueHeading ?? "",
    navStatus: report.NavigationalStatus ?? "",
    shipName: meta.ShipName ?? "",
    shipType: msg.ShipStaticData?.Type ?? msg.ExtendedClassBPositionReport?.ShipType ?? "",
    raw_json: JSON.stringify(data),
  };

  return CSV_COLUMNS.map((col) => csvField(fields[col])).join(",");
}

module.exports = { Recorder, RECORDINGS_DIR };
