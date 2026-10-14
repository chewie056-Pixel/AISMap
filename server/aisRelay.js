"use strict";

// Relais AISStream côté serveur : une seule connexion WebSocket persistante
// vers AISStream.io, partagée par tous les onglets navigateur connectés au
// serveur. Ceci évite le problème rencontré avec une connexion par onglet :
// AISStream ferme abruptement (code 1006) les connexions excédentaires
// utilisant la même clé API.

const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const WebSocket = require("ws");

// Substituable en test (voir server/test_e2e.js) pour éviter de dépendre
// d'un accès réseau réel à AISStream.io.
const AIS_STREAM_URL = process.env.AIS_STREAM_URL_OVERRIDE || "wss://stream.aisstream.io/v0/stream";
const CONFIG_PATH = path.join(__dirname, "config.json");

const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30000;

const FILTER_MESSAGE_TYPES = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
  "ShipStaticData",
  "StaticDataReport",
  "BaseStationReport",
  "AidsToNavigationReport",
  "SafetyBroadcastMessage",
];

class AisRelay extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.apiKey = null;
    this.zone = null;
    this.manualDisconnect = true;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.state = "disconnected";
    this.statusText = "Non configuré";

    this._loadConfig();
    if (this.apiKey && this.zone) {
      this._connect();
    }
  }

  _loadConfig() {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const config = JSON.parse(raw);
      if (config.apiKey && config.zone) {
        this.apiKey = config.apiKey;
        this.zone = config.zone;
      }
    } catch {
      // Aucune configuration existante, ou fichier corrompu : ignoré.
    }
  }

  _saveConfig() {
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({ apiKey: this.apiKey, zone: this.zone }, null, 2)
    );
  }

  getStatus() {
    return { state: this.state, text: this.statusText };
  }

  getZone() {
    return this.zone;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.zone);
  }

  // Configure (ou reconfigure) la clé API et la zone, persistées sur disque,
  // puis (re)connecte immédiatement.
  configure(apiKey, zone) {
    this.apiKey = apiKey;
    this.zone = zone;
    this._saveConfig();
    this._emitConfig();
    this._reconnect();
  }

  setZone(zone) {
    this.zone = zone;
    this._saveConfig();
    this._emitConfig();
    if (this.isConfigured()) this._reconnect();
  }

  _emitConfig() {
    this.emit("config", { configured: this.isConfigured(), zone: this.zone });
  }

  // (Re)connecte avec la configuration déjà enregistrée (ex : après un
  // "Se déconnecter" manuel, sans redemander la clé API).
  connect() {
    if (this.isConfigured()) this._reconnect();
  }

  disconnect() {
    this.manualDisconnect = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._setStatus("disconnected", "Déconnecté");
  }

  _reconnect() {
    this.manualDisconnect = true;
    clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
    this._connect();
  }

  _setStatus(state, text) {
    this.state = state;
    this.statusText = text;
    this.emit("status", { state, text });
  }

  _connect() {
    if (!this.isConfigured()) {
      this._setStatus("disconnected", "Non configuré");
      return;
    }

    this.manualDisconnect = false;
    this._setStatus("connecting", "Connexion en cours…");

    let ws;
    try {
      ws = new WebSocket(AIS_STREAM_URL);
    } catch (e) {
      console.error("AIS relay: impossible d'ouvrir la connexion WebSocket", e);
      this._setStatus("error", "Impossible d'ouvrir la connexion WebSocket");
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
      ws.send(
        JSON.stringify({
          APIKey: this.apiKey,
          BoundingBoxes: [zoneBounds(this.zone)],
          FilterMessageTypes: FILTER_MESSAGE_TYPES,
        })
      );
      this._setStatus("connected", "Connecté — en attente de données…");
    });

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString("utf-8"));
      } catch (e) {
        console.warn("AIS relay: message non-JSON ignoré", e);
        return;
      }

      if (data.error) {
        console.error("AIS relay: erreur reçue du serveur AISStream", data.error);
        this._setStatus("error", data.error);
        return;
      }

      this.emit("data", data);
    });

    ws.on("error", (err) => {
      console.error("AIS relay: erreur WebSocket", err.message);
    });

    ws.on("close", (code, reason) => {
      this.ws = null;
      if (this.manualDisconnect) {
        this._setStatus("disconnected", "Déconnecté");
        return;
      }
      const codeInfo = code ? ` (code ${code}${reason ? " — " + reason : ""})` : "";
      this._setStatus("error", `Connexion perdue${codeInfo} — nouvelle tentative…`);
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY_MS
    );
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.manualDisconnect) this._connect();
    }, delay);
  }
}

function zoneBounds(zone) {
  return [
    [zone.south, zone.west],
    [zone.north, zone.east],
  ];
}

module.exports = { AisRelay };
