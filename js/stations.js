// Page "Stations" — liste les stations AIS de base (Base Station Report,
// message AIS type 4) qui émettent dans la zone configurée sur la page
// principale. Réutilise la clé API et la zone déjà enregistrées.

let ws = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let renderDirty = false;

const stations = new Map(); // mmsi -> { mmsi, lat, lon, lastSeen, ... }
const vesselPositions = new Map(); // mmsi -> { lat, lon } (position seule, pour l'estimation de proximité)

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheDomRefs();
  els.proximityRadius.textContent = STATION_PROXIMITY_RADIUS_KM;

  const apiKey = localStorage.getItem(STORAGE_KEY_API);
  const zone = loadZone();

  if (!apiKey || !zone) {
    els.noConfig.classList.remove("hidden");
    els.content.classList.add("hidden");
    return;
  }

  els.noConfig.classList.add("hidden");
  els.content.classList.remove("hidden");
  showZoneSummary(zone);
  connect(apiKey, zone);

  setInterval(() => {
    if (renderDirty) {
      renderStations();
      renderDirty = false;
    }
  }, 2000);
}

function cacheDomRefs() {
  els.status = document.getElementById("status");
  els.statusText = document.getElementById("status-text");
  els.noConfig = document.getElementById("stations-no-config");
  els.content = document.getElementById("stations-content");
  els.zoneNorth = document.getElementById("zone-summary-north");
  els.zoneSouth = document.getElementById("zone-summary-south");
  els.zoneWest = document.getElementById("zone-summary-west");
  els.zoneEast = document.getElementById("zone-summary-east");
  els.totalCount = document.getElementById("stations-total-count");
  els.tbody = document.getElementById("stations-tbody");
  els.emptyRow = document.getElementById("stations-empty-row");
  els.error = document.getElementById("stations-error");
  els.proximityRadius = document.getElementById("proximity-radius");
}

function loadZone() {
  const raw = localStorage.getItem(STORAGE_KEY_ZONE);
  if (!raw) return null;
  try {
    const zone = JSON.parse(raw);
    if (zone.north > zone.south && zone.east > zone.west) return zone;
  } catch {
    // ignore corrupted value
  }
  return null;
}

function showZoneSummary(zone) {
  els.zoneNorth.textContent = zone.north;
  els.zoneSouth.textContent = zone.south;
  els.zoneWest.textContent = zone.west;
  els.zoneEast.textContent = zone.east;
}

function zoneBounds(zone) {
  return [
    [zone.south, zone.west],
    [zone.north, zone.east],
  ];
}

function setStatus(state, text) {
  els.status.className = "status status-" + state;
  els.statusText.textContent = text;
}

function connect(apiKey, zone) {
  setStatus("connecting", "Connexion en cours…");

  try {
    ws = new WebSocket(AIS_STREAM_URL);
  } catch {
    setStatus("error", "Impossible d'ouvrir la connexion WebSocket");
    return;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
    ws.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [zoneBounds(zone)],
        FilterMessageTypes: ["BaseStationReport", "PositionReport", "StandardClassBPositionReport"],
      })
    );
    setStatus("connected", "Connecté — en attente de stations…");
  };

  ws.onmessage = (evt) => readAisMessage(evt, handleData);

  ws.onerror = () => {
    setStatus("error", "Erreur de connexion");
  };

  ws.onclose = () => {
    setStatus("error", "Connexion perdue — nouvelle tentative…");
    scheduleReconnect(apiKey, zone);
  };
}

function scheduleReconnect(apiKey, zone) {
  reconnectAttempts++;
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttempts - 1),
    RECONNECT_MAX_DELAY_MS
  );
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(apiKey, zone), delay);
}

function handleData(data) {
  if (data.error) {
    console.error("AIS: erreur reçue du serveur", data.error);
    els.error.textContent = data.error;
    els.error.classList.remove("hidden");
    setStatus("error", data.error);
    return;
  }

  const stationReport = parseBaseStationReport(data);
  if (stationReport) {
    stations.set(stationReport.mmsi, { ...stationReport, lastSeen: Date.now() });
    renderDirty = true;
    return;
  }

  const posReport =
    data.Message?.PositionReport || data.Message?.StandardClassBPositionReport;
  if (posReport) {
    const meta = data.MetaData || {};
    const mmsi = meta.MMSI ?? meta.Mmsi ?? posReport.UserID;
    const lat = meta.latitude ?? meta.Latitude ?? posReport.Latitude ?? posReport.latitude;
    const lon = meta.longitude ?? meta.Longitude ?? posReport.Longitude ?? posReport.longitude;
    if (mmsi && lat !== undefined && lon !== undefined) {
      vesselPositions.set(mmsi, { lat, lon });
      renderDirty = true;
    }
  }
}

// Nombre de navires actuellement suivis dans un rayon de la station. AIS ne
// relie pas un message navire à la station qui l'a reçu : il s'agit d'une
// estimation par proximité géographique, pas d'un décompte réel de réception.
function countNearbyVessels(station) {
  let count = 0;
  for (const pos of vesselPositions.values()) {
    if (haversineKm(station.lat, station.lon, pos.lat, pos.lon) <= STATION_PROXIMITY_RADIUS_KM) {
      count++;
    }
  }
  return count;
}

function renderStations() {
  const rows = Array.from(stations.values()).sort((a, b) => a.mmsi - b.mmsi);

  els.totalCount.textContent = rows.length;

  if (rows.length === 0) {
    els.tbody.innerHTML = "";
    els.tbody.appendChild(els.emptyRow);
    return;
  }

  els.tbody.innerHTML = rows
    .map(
      (s) => `
        <tr>
          <td>${s.mmsi}</td>
          <td>${s.name || "—"}</td>
          <td>${s.lat.toFixed(4)}</td>
          <td>${s.lon.toFixed(4)}</td>
          <td>${epfdLabel(s.epfd)}</td>
          <td>${s.raim === undefined ? "—" : s.raim ? "Oui" : "Non"}</td>
          <td>${s.stationUtc ? s.stationUtc.toLocaleTimeString("fr-FR", { timeZone: "UTC" }) + " UTC" : "—"}</td>
          <td>${countNearbyVessels(s)}</td>
          <td>${new Date(s.lastSeen).toLocaleTimeString("fr-FR")}</td>
        </tr>`
    )
    .join("");
}
