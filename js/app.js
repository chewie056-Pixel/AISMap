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
let visibleVesselCount = 0;
let lastStatusUpdate = 0;
let aggregationEnabled = true;
let showStationsOnMap = false;
let stationsLayerGroup;
let showAidsOnMap = false;
let aidsLayerGroup;
let drawingZone = false;
let drawStartLatLng = null;
let drawRectangle = null;

const MAX_SAFETY_MESSAGES = 20;

const vessels = new Map(); // mmsi -> vessel state
const stations = new Map(); // mmsi -> station state (Base Station Report)
const aidsToNav = new Map(); // mmsi -> aide à la navigation (AtoN, type 21)
const safetyMessages = []; // messages de sécurité (type 14), le plus récent en premier

// Cette page détient la seule connexion WebSocket réelle. Elle diffuse les
// données/statut aux autres pages (Stations) via ce canal, pour éviter que
// plusieurs onglets n'ouvrent chacun leur propre connexion (AISStream ferme
// alors les connexions de façon abrupte).
const broadcastChannel = new BroadcastChannel(AIS_BROADCAST_CHANNEL);
let lastStatusState = "disconnected";
let lastStatusText = "Déconnecté";

broadcastChannel.onmessage = (evt) => {
  if (evt.data?.type === "request-status") {
    broadcastChannel.postMessage({ type: "status", state: lastStatusState, text: lastStatusText });
    if (currentZone) broadcastChannel.postMessage({ type: "zone", zone: currentZone });
  }
};

// --- DOM references ---
const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheDomRefs();
  loadZoneFromStorage();
  loadAggregationFromStorage();
  loadShowStationsFromStorage();
  loadShowAidsFromStorage();
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
  els.btnMapMenu = document.getElementById("btn-map-menu");
  els.mapMenu = document.getElementById("map-menu");
  els.btnRecenter = document.getElementById("btn-recenter");
  els.aggregationToggle = document.getElementById("aggregation-toggle");
  els.stationsToggle = document.getElementById("stations-toggle");
  els.aidsToggle = document.getElementById("aids-toggle");
  els.btnDrawZone = document.getElementById("btn-draw-zone");
  els.drawZoneHint = document.getElementById("draw-zone-hint");

  els.loginModal = document.getElementById("login-modal");
  els.apiKeyInput = document.getElementById("api-key-input");
  els.rememberKey = document.getElementById("remember-key");
  els.btnModalConnect = document.getElementById("btn-modal-connect");
  els.loginError = document.getElementById("login-error");
  els.setupZoneNorth = document.getElementById("setup-zone-north");
  els.setupZoneSouth = document.getElementById("setup-zone-south");
  els.setupZoneWest = document.getElementById("setup-zone-west");
  els.setupZoneEast = document.getElementById("setup-zone-east");

  els.zoneNorth = document.getElementById("zone-north");
  els.zoneSouth = document.getElementById("zone-south");
  els.zoneWest = document.getElementById("zone-west");
  els.zoneEast = document.getElementById("zone-east");
  els.btnZoneApply = document.getElementById("btn-zone-apply");

  els.legendList = document.getElementById("legend-list");
  els.legendTotal = document.getElementById("legend-total-count");
  els.legendStationsCount = document.getElementById("legend-stations-count");
  els.legendAidsCount = document.getElementById("legend-aids-count");
  els.legendUpdated = document.getElementById("legend-updated-at");
  els.legendZoomThreshold = document.getElementById("legend-zoom-threshold");
  els.legendFootnote = document.getElementById("legend-footnote");

  els.safetyPanel = document.getElementById("safety-panel");
  els.safetyList = document.getElementById("safety-list");
  els.safetyCount = document.getElementById("safety-count");
  els.btnSafetyClear = document.getElementById("btn-safety-clear");
}

function updateZoomThresholdLabel() {
  els.legendZoomThreshold.textContent = CLUSTER_DISABLE_ZOOM;
  updateAggregationFootnote();
}

function updateAggregationFootnote() {
  els.legendFootnote.textContent = aggregationEnabled
    ? `Zoom ≥ ${CLUSTER_DISABLE_ZOOM} : navires individuels · en-deçà : agrégats`
    : "Agrégation désactivée : tous les navires sont affichés individuellement";
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

  markerClusterGroup = createMarkerLayer();
  map.addLayer(markerClusterGroup);

  stationsLayerGroup = L.layerGroup();
  if (showStationsOnMap) {
    map.addLayer(stationsLayerGroup);
  }

  aidsLayerGroup = L.layerGroup();
  if (showAidsOnMap) {
    map.addLayer(aidsLayerGroup);
  }

  map.on("moveend zoomend", () => recomputeLegend());
}

function loadShowStationsFromStorage() {
  const stored = localStorage.getItem(STORAGE_KEY_SHOW_STATIONS);
  showStationsOnMap = stored === "1";
  els.stationsToggle.checked = showStationsOnMap;
}

function setShowStationsOnMap(enabled) {
  showStationsOnMap = enabled;
  localStorage.setItem(STORAGE_KEY_SHOW_STATIONS, enabled ? "1" : "0");
  if (enabled) {
    map.addLayer(stationsLayerGroup);
  } else {
    map.removeLayer(stationsLayerGroup);
  }
  legendDirty = true;
}

function loadShowAidsFromStorage() {
  const stored = localStorage.getItem(STORAGE_KEY_SHOW_AIDS);
  showAidsOnMap = stored === "1";
  els.aidsToggle.checked = showAidsOnMap;
}

function setShowAidsOnMap(enabled) {
  showAidsOnMap = enabled;
  localStorage.setItem(STORAGE_KEY_SHOW_AIDS, enabled ? "1" : "0");
  if (enabled) {
    map.addLayer(aidsLayerGroup);
  } else {
    map.removeLayer(aidsLayerGroup);
  }
  legendDirty = true;
}

// Selon le mode agrégation, les navires sont regroupés en clusters comptés
// au-delà d'un certain zoom, ou toujours affichés individuellement.
function createMarkerLayer() {
  if (aggregationEnabled) {
    return L.markerClusterGroup({
      disableClusteringAtZoom: CLUSTER_DISABLE_ZOOM,
      maxClusterRadius: 60,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
    });
  }
  return L.layerGroup();
}

function loadAggregationFromStorage() {
  const stored = localStorage.getItem(STORAGE_KEY_AGGREGATION);
  if (stored !== null) {
    aggregationEnabled = stored !== "0";
  }
  els.aggregationToggle.checked = aggregationEnabled;
}

function setAggregationEnabled(enabled) {
  aggregationEnabled = enabled;
  localStorage.setItem(STORAGE_KEY_AGGREGATION, enabled ? "1" : "0");
  updateAggregationFootnote();

  map.removeLayer(markerClusterGroup);
  markerClusterGroup = createMarkerLayer();
  map.addLayer(markerClusterGroup);

  for (const v of vessels.values()) {
    v.marker = null;
    placeVesselMarker(v);
  }
  legendDirty = true;
  recomputeLegend();
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

  els.btnMapMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = els.mapMenu.classList.contains("hidden");
    if (opening) populateZoneInputs();
    els.mapMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!els.mapMenu.classList.contains("hidden") && !e.target.closest(".dropdown")) {
      els.mapMenu.classList.add("hidden");
    }
  });

  els.btnRecenter.addEventListener("click", () => {
    if (zoneRectangle) map.fitBounds(zoneRectangle.getBounds(), { padding: [40, 40] });
    els.mapMenu.classList.add("hidden");
  });
  els.btnZoneApply.addEventListener("click", applyZoneFromInputs);
  els.btnModalConnect.addEventListener("click", handleModalConnect);
  els.aggregationToggle.addEventListener("change", () => {
    setAggregationEnabled(els.aggregationToggle.checked);
  });
  els.stationsToggle.addEventListener("change", () => {
    setShowStationsOnMap(els.stationsToggle.checked);
  });
  els.aidsToggle.addEventListener("change", () => {
    setShowAidsOnMap(els.aidsToggle.checked);
  });
  els.btnDrawZone.addEventListener("click", toggleZoneDrawing);
  els.btnSafetyClear.addEventListener("click", clearSafetyMessages);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawingZone) cancelZoneDrawing();
  });

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
  broadcastChannel.postMessage({ type: "zone", zone: currentZone });
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
  applyNewZone(zone);
  els.mapMenu.classList.add("hidden");
}

// Définit la nouvelle zone active, la persiste, redessine le rectangle et
// reconnecte le flux AISStream dessus si une connexion est déjà en cours.
function applyNewZone(zone) {
  currentZone = zone;
  localStorage.setItem(STORAGE_KEY_ZONE, JSON.stringify(currentZone));
  drawZoneRectangle(currentZone);
  broadcastChannel.postMessage({ type: "zone", zone: currentZone });

  if (currentApiKey) {
    reconnectWithCurrentZone();
  }
}

// --- Dessin de la zone directement sur la carte ---

const MIN_DRAWN_ZONE_SPAN_DEG = 0.05;

function toggleZoneDrawing() {
  if (drawingZone) {
    cancelZoneDrawing();
  } else {
    startZoneDrawing();
  }
}

function startZoneDrawing() {
  drawingZone = true;
  els.btnDrawZone.classList.add("active");
  els.drawZoneHint.classList.remove("hidden");
  els.mapMenu.classList.add("hidden");
  map.dragging.disable();
  map.getContainer().style.cursor = "crosshair";
  map.once("mousedown", onDrawMouseDown);
}

function onDrawMouseDown(e) {
  drawStartLatLng = e.latlng;
  drawRectangle = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
    color: "#27ae60",
    weight: 2,
    fill: true,
    fillOpacity: 0.1,
    dashArray: "4,4",
  }).addTo(map);
  map.on("mousemove", onDrawMouseMove);
  map.once("mouseup", onDrawMouseUp);
}

function onDrawMouseMove(e) {
  if (!drawRectangle || !drawStartLatLng) return;
  drawRectangle.setBounds(L.latLngBounds(drawStartLatLng, e.latlng));
}

function onDrawMouseUp() {
  map.off("mousemove", onDrawMouseMove);
  const bounds = drawRectangle ? drawRectangle.getBounds() : null;
  finishZoneDrawing(bounds);
}

function finishZoneDrawing(bounds) {
  resetDrawingState();
  if (!bounds) return;

  const north = bounds.getNorth();
  const south = bounds.getSouth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  if (north - south < MIN_DRAWN_ZONE_SPAN_DEG || east - west < MIN_DRAWN_ZONE_SPAN_DEG) {
    return; // simple clic sans glisser : rectangle dégénéré, on ignore
  }

  applyNewZone({ north, south, west, east });
}

function cancelZoneDrawing() {
  map.off("mousedown", onDrawMouseDown);
  map.off("mouseup", onDrawMouseUp);
  resetDrawingState();
}

function resetDrawingState() {
  drawingZone = false;
  drawStartLatLng = null;
  els.btnDrawZone.classList.remove("active");
  els.drawZoneHint.classList.add("hidden");
  map.off("mousemove", onDrawMouseMove);
  map.dragging.enable();
  map.getContainer().style.cursor = "";
  if (drawRectangle) {
    map.removeLayer(drawRectangle);
    drawRectangle = null;
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
    lastStatusUpdate = 0;
    ws.send(
      JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [zoneBounds(currentZone)],
        FilterMessageTypes: [
          "PositionReport",
          "StandardClassBPositionReport",
          "ExtendedClassBPositionReport",
          "ShipStaticData",
          "StaticDataReport",
          "BaseStationReport",
          "AidsToNavigationReport",
          "SafetyBroadcastMessage",
        ],
      })
    );
    setStatus("connected", "Connecté — en attente de données…");
  };

  ws.onmessage = (evt) => readAisMessage(evt, onAisData);

  ws.onerror = (evt) => {
    console.error("AIS: erreur WebSocket", evt);
    setStatus("error", "Erreur de connexion");
  };

  ws.onclose = (evt) => {
    console.warn("AIS: connexion fermée", {
      code: evt.code,
      reason: evt.reason,
      wasClean: evt.wasClean,
    });
    if (manualDisconnect) {
      setStatus("disconnected", "Déconnecté");
      return;
    }
    const codeInfo = evt.code ? ` (code ${evt.code}${evt.reason ? " — " + evt.reason : ""})` : "";
    setStatus("error", `Connexion perdue${codeInfo} — nouvelle tentative…`);
    scheduleReconnect();
  };
}

function onAisData(data) {
  messageCount++;
  if (messageCount <= 3) {
    // Aide au diagnostic : affiche la forme brute des premiers messages reçus.
    console.debug("AIS: message reçu", data);
  }
  broadcastChannel.postMessage({ type: "data", payload: data });
  handleMessage(data);

  const now = Date.now();
  if (now - lastStatusUpdate > 1000) {
    lastStatusUpdate = now;
    setStatus(
      "connected",
      `Connecté — ${messageCount} message(s) reçu(s), ${visibleVesselCount} navire(s) dans la vue`
    );
  }
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

  lastStatusState = state;
  lastStatusText = text;
  broadcastChannel.postMessage({ type: "status", state, text });
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

  if (data.Message?.BaseStationReport) {
    upsertStation(data);
    return;
  }
  if (data.Message?.AidsToNavigationReport) {
    upsertAidToNav(data);
    return;
  }
  if (data.Message?.SafetyBroadcastMessage) {
    addSafetyMessage(data);
    return;
  }

  const meta = data.MetaData || {};
  const extendedClassB = data.Message?.ExtendedClassBPositionReport;
  const posReport =
    data.Message?.PositionReport ||
    data.Message?.StandardClassBPositionReport ||
    extendedClassB;
  const staticDataReport = data.Message?.StaticDataReport;
  const mmsi =
    meta.MMSI ??
    meta.Mmsi ??
    posReport?.UserID ??
    data.Message?.ShipStaticData?.UserID ??
    staticDataReport?.UserID;

  if (!mmsi) {
    console.warn("AIS: MMSI introuvable dans le message, ignoré", data);
    return;
  }

  if (extendedClassB) {
    upsertExtendedClassB(mmsi, meta, extendedClassB);
  } else if (posReport) {
    upsertPosition(mmsi, meta, posReport);
  } else if (type === "ShipStaticData" && data.Message?.ShipStaticData) {
    upsertStatic(mmsi, meta, data.Message.ShipStaticData);
  } else if (staticDataReport) {
    upsertStaticDataReport(mmsi, meta, staticDataReport);
  } else {
    console.debug("AIS: type de message non traité", type);
  }
}

// AIS type 19 : comme un StandardClassBPositionReport (position), mais avec
// en plus le nom/type du navire inclus directement dans le même message (pas
// besoin d'un StaticDataReport séparé pour ces champs).
function upsertExtendedClassB(mmsi, meta, report) {
  upsertPosition(mmsi, meta, report);
  const v = vessels.get(mmsi);
  if (!v) return;

  const name = (report.Name || meta.ShipName || "").trim();
  if (name) v.name = name;
  if (report.ShipType !== undefined) v.category = categorizeShipType(report.ShipType);

  if (v.marker) v.marker.setIcon(vesselIcon(v));
  legendDirty = true;
}

function upsertStation(data) {
  const parsed = parseBaseStationReport(data);
  if (!parsed) {
    console.warn("AIS: station de base sans position exploitable, ignorée", data);
    return;
  }

  let s = stations.get(parsed.mmsi);
  if (!s) {
    s = { ...parsed, lastSeen: Date.now(), marker: null };
    stations.set(parsed.mmsi, s);
  } else {
    Object.assign(s, parsed, { lastSeen: Date.now() });
  }

  if (!s.marker) {
    s.marker = L.marker([s.lat, s.lon], { icon: stationIcon() });
    s.marker.bindPopup("", { closeButton: true });
    s.marker.on("popupopen", () => s.marker.setPopupContent(stationPopupContent(s)));
    stationsLayerGroup.addLayer(s.marker);
  } else {
    s.marker.setLatLng([s.lat, s.lon]);
  }
}

function stationIcon() {
  return L.divIcon({
    className: "station-icon-wrapper",
    html: '<div class="station-marker">📡</div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function stationPopupContent(s) {
  const updated = new Date(s.lastSeen).toLocaleTimeString("fr-FR");
  const stationTime = s.stationUtc
    ? s.stationUtc.toLocaleTimeString("fr-FR", { timeZone: "UTC" }) + " UTC"
    : "—";
  return `
    <div class="vessel-popup">
      <strong>${s.name ? escapeHtml(s.name) : "Station de base"}</strong><br/>
      MMSI : ${s.mmsi}<br/>
      Positionnement (EPFD) : ${epfdLabel(s.epfd)}<br/>
      RAIM : ${s.raim === undefined ? "—" : s.raim ? "Oui" : "Non"}<br/>
      Heure station : ${stationTime}<br/>
      Dernière réception : ${updated}
    </div>`;
}

// AIS type 21 : aides à la navigation (bouées, phares, balises, AtoN virtuels).
function upsertAidToNav(data) {
  const parsed = parseAidsToNavigationReport(data);
  if (!parsed) {
    console.warn("AIS: aide à la navigation sans position exploitable, ignorée", data);
    return;
  }

  let a = aidsToNav.get(parsed.mmsi);
  if (!a) {
    a = { ...parsed, lastSeen: Date.now(), marker: null };
    aidsToNav.set(parsed.mmsi, a);
  } else {
    Object.assign(a, parsed, { lastSeen: Date.now() });
  }

  if (!a.marker) {
    a.marker = L.marker([a.lat, a.lon], { icon: aidIcon() });
    a.marker.bindPopup("", { closeButton: true });
    a.marker.on("popupopen", () => a.marker.setPopupContent(aidPopupContent(a)));
    aidsLayerGroup.addLayer(a.marker);
  } else {
    a.marker.setLatLng([a.lat, a.lon]);
  }
  legendDirty = true;
}

function aidIcon() {
  return L.divIcon({
    className: "aid-icon-wrapper",
    html: '<div class="aid-marker">⚓</div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function aidPopupContent(a) {
  const updated = new Date(a.lastSeen).toLocaleTimeString("fr-FR");
  return `
    <div class="vessel-popup">
      <strong>${a.name ? escapeHtml(a.name) : "Aide à la navigation"}</strong><br/>
      MMSI : ${a.mmsi}<br/>
      Type : ${aidTypeLabel(a.type)}<br/>
      ${a.virtual ? "AtoN virtuel<br/>" : ""}
      ${a.offPosition ? "⚠ Hors position<br/>" : ""}
      Dernière réception : ${updated}
    </div>`;
}

// --- Messages de sécurité (AIS type 14) ---

function addSafetyMessage(data) {
  const meta = data.MetaData || {};
  const report = data.Message.SafetyBroadcastMessage;
  const text = (report.Text ?? report.SafetyText ?? "").trim();
  if (!text) return;

  safetyMessages.unshift({
    mmsi: meta.MMSI ?? meta.Mmsi ?? report.UserID,
    name: meta.ShipName,
    text,
    time: Date.now(),
  });
  safetyMessages.length = Math.min(safetyMessages.length, MAX_SAFETY_MESSAGES);
  renderSafetyMessages();
}

function renderSafetyMessages() {
  if (safetyMessages.length === 0) {
    els.safetyPanel.classList.add("hidden");
    return;
  }
  els.safetyPanel.classList.remove("hidden");
  els.safetyCount.textContent = `(${safetyMessages.length})`;
  els.safetyList.innerHTML = safetyMessages
    .map((m) => {
      const who = m.name || (m.mmsi ? `MMSI ${m.mmsi}` : "Émetteur inconnu");
      return `<li>${escapeHtml(m.text)}<br/><span class="safety-meta">${escapeHtml(who)} · ${new Date(m.time).toLocaleTimeString("fr-FR")}</span></li>`;
    })
    .join("");
}

function clearSafetyMessages() {
  safetyMessages.length = 0;
  renderSafetyMessages();
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

// AIS type 24 (Static Data Report) : utilisé par les navires Classe B, en
// deux parties (A = nom, B = type/indicatif/dimensions) au lieu du message
// type 5 (ShipStaticData) réservé aux navires Classe A.
function upsertStaticDataReport(mmsi, meta, sdr) {
  const v = getOrCreateVessel(mmsi);
  const partNumber = sdr.PartNumber ?? sdr.partNumber;
  const reportA = sdr.ReportA ?? (partNumber === 0 ? sdr : null);
  const reportB = sdr.ReportB ?? (partNumber === 1 ? sdr : null);

  const name = (reportA?.Name ?? sdr.Name ?? meta.ShipName ?? "").trim();
  if (name) v.name = name;

  const shipType = reportB?.ShipType ?? sdr.ShipType ?? sdr.Type;
  if (shipType !== undefined) v.category = categorizeShipType(shipType);

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
      <strong>${v.name ? escapeHtml(v.name) : "Nom inconnu"}</strong><br/>
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

  stationsLayerGroup.clearLayers();
  stations.clear();

  aidsLayerGroup.clearLayers();
  aidsToNav.clear();
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

  visibleVesselCount = total;

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

  els.legendStationsCount.textContent = showStationsOnMap ? countInBounds(stations, bounds) : 0;
  els.legendAidsCount.textContent = showAidsOnMap ? countInBounds(aidsToNav, bounds) : 0;

  els.legendUpdated.textContent = new Date().toLocaleTimeString("fr-FR");
}

function countInBounds(items, bounds) {
  let count = 0;
  for (const item of items.values()) {
    if (item.lat === undefined || item.lon === undefined) continue;
    if (bounds.contains([item.lat, item.lon])) count++;
  }
  return count;
}
