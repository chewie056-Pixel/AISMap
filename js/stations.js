// Page "Stations" — liste les stations AIS de base (Base Station Report,
// message AIS type 4) qui émettent dans la zone surveillée par le serveur
// local. Se connecte directement au serveur (comme la page principale) :
// aucune dépendance à un autre onglet ouvert.

let serverWs = null;
let serverReconnectAttempts = 0;
let serverReconnectTimer = null;
let renderDirty = false;

const stations = new Map(); // mmsi -> { mmsi, lat, lon, lastSeen, ... }
const vesselPositions = new Map(); // mmsi -> { lat, lon } (position seule, pour l'estimation de proximité)

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheDomRefs();
  els.proximityRadius.textContent = STATION_PROXIMITY_RADIUS_KM;
  connectToServer();

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
  els.proximityRadius = document.getElementById("proximity-radius");
}

function showZoneSummary(zone) {
  els.zoneNorth.textContent = zone.north;
  els.zoneSouth.textContent = zone.south;
  els.zoneWest.textContent = zone.west;
  els.zoneEast.textContent = zone.east;
}

function setStatus(state, text) {
  els.status.className = "status status-" + state;
  els.statusText.textContent = text;
}

// --- Connexion au serveur local ---

function connectToServer() {
  let socket;
  try {
    socket = new WebSocket(SERVER_WS_URL);
  } catch {
    setStatus("error", "Impossible de joindre le serveur local");
    scheduleServerReconnect();
    return;
  }
  serverWs = socket;

  socket.onopen = () => {
    serverReconnectAttempts = 0;
  };

  socket.onmessage = (evt) => readAisMessage(evt, handleServerMessage);

  socket.onerror = (evt) => {
    console.error("Serveur local : erreur WebSocket", evt);
  };

  socket.onclose = () => {
    serverWs = null;
    setStatus("error", "Connexion au serveur local perdue — nouvelle tentative…");
    scheduleServerReconnect();
  };
}

function scheduleServerReconnect() {
  serverReconnectAttempts++;
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** (serverReconnectAttempts - 1),
    RECONNECT_MAX_DELAY_MS
  );
  clearTimeout(serverReconnectTimer);
  serverReconnectTimer = setTimeout(connectToServer, delay);
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case "status":
      setStatus(msg.state, msg.text);
      break;
    case "config":
      els.noConfig.classList.toggle("hidden", msg.configured);
      els.content.classList.toggle("hidden", !msg.configured);
      if (msg.zone) showZoneSummary(msg.zone);
      break;
    case "data":
      handleData(msg.payload);
      break;
    default:
      break;
  }
}

function handleData(data) {
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
          <td>${s.name ? escapeHtml(s.name) : "—"}</td>
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
