// AIS Tracker
// Connexion directe (WebSocket navigateur) à AISStream.io, affichage Leaflet.

let map, markerClusterGroup, zoneRectangle;
let ws = null;
let manualDisconnect = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let currentApiKey = null;
let currentZone = { ...DEFAULT_ZONE }; // modifiable par l'utilisateur avant connexion
let legendDirty = true;
let messageCount = 0;

const vessels = new Map(); // mmsi -> vessel state

// --- DOM references ---
const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheDomRefs();
  loadZoneFromStorage();
  initMap();
  wireUi();
  updateZoomThresholdLabel();
  setStatus("disconnected", "Déconnecté");

  setInterval(() => {
    if (legendDirty) {
      recomputeLegend();
      legendDirty = false;
    }
  }, 2000);
  setInterval(removeStaleVessels, STALE_CHECK_INTERVAL_MS);

  const storedKey = localStorage.getItem(STORAGE_KEY_API);
  if (storedKey && currentZone) {
    connect(storedKey);
  } else {
    showLoginModal();
  }
}

function cacheDomRefs() {
  els.status = document.getElementById("status");
  els.statusText = document.getElementById("status-text");
  els.btnConnect = document.getElementById("btn-connect");
  els.btnDisconnect = document.getElementById("btn-disconnect");
  els.btnRecenter = document.getElementById("btn-recenter");
  els.btnZoneToggle = document.getElementById("btn-zone-toggle");

  els.loginModal = document.getElementById("login-modal");
  els.apiKeyInput = document.getElementById("api-key-input");
  els.rememberKey = document.getElementById("remember-key");
  els.btnModalConnect = document.getElementById("btn-modal-connect");
  els.loginError = document.getElementById("login-error");
  els.setupZoneNorth = document.getElementById("setup-zone-north");
  els.setupZoneSouth = document.getElementById("setup-zone-south");
  els.setupZoneWest = document.getElementById("setup-zone-west");
  els.setupZoneEast = document.getElementById("setup-zone-east");

  els.zonePanel = document.getElementById("zone-panel");
  els.zoneNorth = document.getElementById("zone-north");
  els.zoneSouth = document.getElementById("zone-south");
  els.zoneWest = document.getElementById("zone-west");
  els.zoneEast = document.getElementById("zone-east");
  els.btnZoneApply = document.getElementById("btn-zone-apply");

  els.legendList = document.getElementById("legend-list");
  els.legendTotal = document.getElementById("legend-total-count");
  els.legendUpdated = document.getElementById("legend-updated-at");
  els.legendZoomThreshold = document.getElementById("legend-zoom-threshold");
}

function updateZoomThresholdLabel() {
  els.legendZoomThreshold.textContent = CLUSTER_DISABLE_ZOOM;
}

// --- Carte ---

function initMap() {
  map = L.map("map", { worldCopyJump: true, minZoom: 2 }).setView([20, 0], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(map);

  if (currentZone) {
    drawZoneRectangle(currentZone);
  }

  markerClusterGroup = L.markerClusterGroup({
    disableClusteringAtZoom: CLUSTER_DISABLE_ZOOM,
    maxClusterRadius: 60,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: false,
  });
  map.addLayer(markerClusterGroup);

  map.on("moveend zoomend", () => recomputeLegend());
}

function zoneBounds(zone) {
  return [
    [zone.south, zone.west],
    [zone.north, zone.east],
  ];
}

function drawZoneRectangle(zone) {
  const bounds = zoneBounds(zone);
  if (!zoneRectangle) {
    zoneRectangle = L.rectangle(bounds, {
      color: "#ffcc00",
      weight: 2,
      fill: false,
      dashArray: "6,4",
    }).addTo(map);
  } else {
    zoneRectangle.setBounds(bounds);
  }
}

function parseZoneInputs(elNorth, elSouth, elWest, elEast) {
  const north = parseFloat(elNorth.value);
  const south = parseFloat(elSouth.value);
  const west = parseFloat(elWest.value);
  const east = parseFloat(elEast.value);
  if ([north, south, west, east].some(Number.isNaN) || north <= south || east <= west) {
    return null;
  }
  return { north, south, west, east };
}

// --- UI wiring ---

function wireUi() {
  els.btnConnect.addEventListener("click", showLoginModal);
  els.btnDisconnect.addEventListener("click", disconnect);
  els.btnRecenter.addEventListener("click", () => {
    if (!zoneRectangle) return;
    map.fitBounds(zoneRectangle.getBounds(), { padding: [40, 40] });
  });
  els.btnZoneToggle.addEventListener("click", () => {
    populateZoneInputs();
    els.zonePanel.classList.toggle("hidden");
  });
  els.btnZoneApply.addEventListener("click", applyZoneFromInputs);
  els.btnModalConnect.addEventListener("click", handleModalConnect);

  const stored = localStorage.getItem(STORAGE_KEY_API);
  if (stored) els.apiKeyInput.value = stored;
}

function showLoginModal() {
  els.loginError.classList.add("hidden");
  if (currentZone) {
    els.setupZoneNorth.value = currentZone.north;
    els.setupZoneSouth.value = currentZone.south;
    els.setupZoneWest.value = currentZone.west;
    els.setupZoneEast.value = currentZone.east;
  }
  els.loginModal.classList.remove("hidden");
}

function hideLoginModal() {
  els.loginModal.classList.add("hidden");
}

function handleModalConnect() {
  const key = els.apiKeyInput.value.trim();
  if (!key) {
    showLoginError("Veuillez entrer une clé API AISStream.io.");
    return;
  }

  const zone = parseZoneInputs(
    els.setupZoneNorth,
    els.setupZoneSouth,
    els.setupZoneWest,
    els.setupZoneEast
  );
  if (!zone) {
    showLoginError("Veuillez définir une zone géographique valide (Nord > Sud, Est > Ouest).");
    return;
  }

  currentZone = zone;
  localStorage.setItem(STORAGE_KEY_ZONE, JSON.stringify(currentZone));
  drawZoneRectangle(currentZone);
  map.fitBounds(zoneRectangle.getBounds(), { padding: [40, 40] });

  if (els.rememberKey.checked) {
    localStorage.setItem(STORAGE_KEY_API, key);
  } else {
    localStorage.removeItem(STORAGE_KEY_API);
  }
  hideLoginModal();
  connect(key);
}

function showLoginError(message) {
  els.loginError.textContent = message;
  els.loginError.classList.remove("hidden");
  els.loginModal.classList.remove("hidden");
}

function populateZoneInputs() {
  if (!currentZone) return;
  els.zoneNorth.value = currentZone.north;
  els.zoneSouth.value = currentZone.south;
  els.zoneWest.value = currentZone.west;
  els.zoneEast.value = currentZone.east;
}

function applyZoneFromInputs() {
  const zone = parseZoneInputs(els.zoneNorth, els.zoneSouth, els.zoneWest, els.zoneEast);
  if (!zone) {
    alert("Coordonnées invalides : vérifiez que Nord > Sud et Est > Ouest.");
    return;
  }

  currentZone = zone;
  localStorage.setItem(STORAGE_KEY_ZONE, JSON.stringify(currentZone));
  drawZoneRectangle(currentZone);
  els.zonePanel.classList.add("hidden");

  if (currentApiKey) {
    reconnectWithCurrentZone();
  }
}

function loadZoneFromStorage() {
  const raw = localStorage.getItem(STORAGE_KEY_ZONE);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.north > parsed.south && parsed.east > parsed.west) {
      currentZone = parsed;
    }
  } catch {
    // ignore corrupted value
  }
}

// --- Connexion WebSocket AISStream ---

function connect(apiKey) {
  manualDisconnect = false;
  currentApiKey = apiKey;
  setStatus("connecting", "Connexion en cours…");

  try {
    ws = new WebSocket(AIS_STREAM_URL);
  } catch {
    setStatus("error", "Impossible d'ouvrir la connexion WebSocket");
    return;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
    messageCount = 0;
    ws.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [zoneBounds(currentZone)],
        FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport", "ShipStaticData"],
      })
    );
    setStatus("connected", "Connecté — en attente de données…");
  };

  ws.onmessage = (evt) => {
    // AISStream envoie parfois les frames en binaire : evt.data peut être une
    // chaîne, un Blob ou un ArrayBuffer selon le navigateur/serveur.
    if (typeof evt.data === "string") {
      processRawMessage(evt.data);
    } else if (evt.data instanceof Blob) {
      evt.data.text().then(processRawMessage);
    } else if (evt.data instanceof ArrayBuffer) {
      processRawMessage(new TextDecoder("utf-8").decode(evt.data));
    }
  };

  ws.onerror = () => {
    setStatus("error", "Erreur de connexion");
  };

  ws.onclose = () => {
    if (manualDisconnect) {
      setStatus("disconnected", "Déconnecté");
      return;
    }
    setStatus("error", "Connexion perdue — nouvelle tentative…");
    scheduleReconnect();
  };
}

function processRawMessage(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn("AIS: message non-JSON ignoré", raw, e);
    return;
  }
  messageCount++;
  if (messageCount <= 3) {
    // Aide au diagnostic : affiche la forme brute des premiers messages reçus.
    console.debug("AIS: message reçu", data);
  }
  handleMessage(data);
  setStatus("connected", `Connecté — ${messageCount} message(s) reçu(s), ${vessels.size} navire(s) suivi(s)`);
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttempts - 1),
    RECONNECT_MAX_DELAY_MS
  );
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!manualDisconnect && currentApiKey) connect(currentApiKey);
  }, delay);
}

function disconnect() {
  manualDisconnect = true;
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.close();
    ws = null;
  }
  clearAllVessels();
  setStatus("disconnected", "Déconnecté");
}

function reconnectWithCurrentZone() {
  manualDisconnect = true;
  clearTimeout(reconnectTimer);
  if (ws) ws.close();
  clearAllVessels();
  connect(currentApiKey);
}

function setStatus(state, text) {
  els.status.className = "status status-" + state;
  els.statusText.textContent = text;
  const busy = state === "connected" || state === "connecting";
  els.btnConnect.classList.toggle("hidden", busy);
  els.btnDisconnect.classList.toggle("hidden", !busy);
}

// --- Traitement des messages AIS ---

function handleMessage(data) {
  if (data.error) {
    console.error("AIS: erreur reçue du serveur", data.error);
    showLoginError(data.error);
    setStatus("error", data.error);
    disconnect();
    return;
  }

  const type = data.MessageType;
  const meta = data.MetaData || {};
  const posReport =
    data.Message?.PositionReport || data.Message?.StandardClassBPositionReport;
  const mmsi =
    meta.MMSI ?? meta.Mmsi ?? posReport?.UserID ?? data.Message?.ShipStaticData?.UserID;

  if (!mmsi) {
    console.warn("AIS: MMSI introuvable dans le message, ignoré", data);
    return;
  }

  if (posReport) {
    upsertPosition(mmsi, meta, posReport);
  } else if (type === "ShipStaticData" && data.Message?.ShipStaticData) {
    upsertStatic(mmsi, meta, data.Message.ShipStaticData);
  } else {
    console.debug("AIS: type de message non traité", type);
  }
}

function getOrCreateVessel(mmsi) {
  let v = vessels.get(mmsi);
  if (!v) {
    v = { mmsi, category: "unknown", marker: null };
    vessels.set(mmsi, v);
  }
  return v;
}

function upsertPosition(mmsi, meta, pr) {
  const v = getOrCreateVessel(mmsi);
  v.lat = meta.latitude ?? meta.Latitude ?? pr.Latitude ?? pr.latitude;
  v.lon = meta.longitude ?? meta.Longitude ?? pr.Longitude ?? pr.longitude;
  v.cog = pr.Cog;
  v.sog = pr.Sog;
  v.heading = pr.TrueHeading;
  v.navStatus = pr.NavigationalStatus;
  if (!v.name && meta.ShipName) v.name = meta.ShipName.trim();
  v.lastUpdate = Date.now();
  if (v.lat === undefined || v.lon === undefined) {
    console.warn("AIS: position sans latitude/longitude exploitable, ignorée", { mmsi, meta, pr });
    return;
  }
  placeVesselMarker(v);
  legendDirty = true;
}

function upsertStatic(mmsi, meta, sd) {
  const v = getOrCreateVessel(mmsi);
  const name = (sd.Name || meta.ShipName || "").trim();
  if (name) v.name = name;
  v.category = categorizeShipType(sd.Type);
  v.lastUpdate = v.lastUpdate || Date.now();
  if (v.marker) {
    v.marker.setIcon(vesselIcon(v));
  }
  legendDirty = true;
}

function placeVesselMarker(v) {
  if (v.lat === undefined || v.lon === undefined) return;
  if (!v.marker) {
    v.marker = L.marker([v.lat, v.lon], { icon: vesselIcon(v) });
    v.marker.bindPopup("", { closeButton: true });
    v.marker.on("popupopen", () => v.marker.setPopupContent(popupContent(v)));
    markerClusterGroup.addLayer(v.marker);
  } else {
    v.marker.setLatLng([v.lat, v.lon]);
    v.marker.setIcon(vesselIcon(v));
  }
}

function vesselIcon(v) {
  const cat = SHIP_CATEGORIES[v.category] || SHIP_CATEGORIES.unknown;
  const hasHeading =
    (v.heading !== undefined && v.heading !== null && v.heading !== 511) ||
    (v.cog !== undefined && v.cog !== null);
  const angle = hasHeading
    ? v.heading !== undefined && v.heading !== 511
      ? v.heading
      : v.cog
    : 0;
  const html = `<div class="vessel-marker${hasHeading ? "" : " no-heading"}" style="--vcolor:${cat.color}; transform:rotate(${angle}deg)"></div>`;
  return L.divIcon({
    className: "vessel-icon-wrapper",
    html,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function popupContent(v) {
  const cat = SHIP_CATEGORIES[v.category] || SHIP_CATEGORIES.unknown;
  const updated = v.lastUpdate ? new Date(v.lastUpdate).toLocaleTimeString("fr-FR") : "—";
  return `
    <div class="vessel-popup">
      <strong>${v.name || "Nom inconnu"}</strong><br/>
      MMSI : ${v.mmsi}<br/>
      Type : ${cat.label}<br/>
      Vitesse : ${v.sog !== undefined ? v.sog.toFixed(1) + " nds" : "—"}<br/>
      Cap : ${v.cog !== undefined ? v.cog.toFixed(0) + "°" : "—"}<br/>
      Statut : ${navStatusLabel(v.navStatus)}<br/>
      Maj : ${updated}
    </div>`;
}

function removeStaleVessels() {
  const now = Date.now();
  for (const [mmsi, v] of vessels) {
    if (v.lastUpdate && now - v.lastUpdate > STALE_VESSEL_MS) {
      if (v.marker) markerClusterGroup.removeLayer(v.marker);
      vessels.delete(mmsi);
      legendDirty = true;
    }
  }
}

function clearAllVessels() {
  markerClusterGroup.clearLayers();
  vessels.clear();
  legendDirty = true;
  recomputeLegend();
}

// --- Légende ---

const LEGEND_ORDER = [
  "cargo",
  "tanker",
  "passenger",
  "fishing",
  "pleasure",
  "highspeed",
  "special",
  "other",
  "unknown",
];

function recomputeLegend() {
  const bounds = map.getBounds();
  const counts = {};
  let total = 0;

  for (const v of vessels.values()) {
    if (v.lat === undefined || v.lon === undefined) continue;
    if (!bounds.contains([v.lat, v.lon])) continue;
    counts[v.category] = (counts[v.category] || 0) + 1;
    total++;
  }

  els.legendList.innerHTML = "";
  for (const cat of LEGEND_ORDER) {
    const info = SHIP_CATEGORIES[cat];
    const count = counts[cat] || 0;
    const li = document.createElement("li");
    if (!count) li.classList.add("legend-empty");
    li.innerHTML = `<span class="legend-swatch" style="background:${info.color}"></span><span class="legend-label">${info.label}</span><span class="legend-count">${count}</span>`;
    els.legendList.appendChild(li);
  }

  els.legendTotal.textContent = total;
  els.legendUpdated.textContent = new Date().toLocaleTimeString("fr-FR");
}
