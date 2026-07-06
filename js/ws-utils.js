// Utilitaires partagés pour la lecture des messages WebSocket AISStream.io

// AISStream envoie parfois les frames en binaire : evt.data peut être une
// chaîne, un Blob ou un ArrayBuffer selon le navigateur/serveur. Décode dans
// tous les cas puis appelle onMessage(data) avec l'objet JSON parsé.
function readAisMessage(evt, onMessage) {
  const parseAndDispatch = (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn("AIS: message non-JSON ignoré", raw, e);
      return;
    }
    onMessage(data);
  };

  if (typeof evt.data === "string") {
    parseAndDispatch(evt.data);
  } else if (evt.data instanceof Blob) {
    evt.data.text().then(parseAndDispatch);
  } else if (evt.data instanceof ArrayBuffer) {
    parseAndDispatch(new TextDecoder("utf-8").decode(evt.data));
  }
}

// Type de dispositif de positionnement électronique (EPFD), norme AIS.
const EPFD_LABELS = {
  0: "Non spécifié",
  1: "GPS",
  2: "GLONASS",
  3: "GPS/GLONASS",
  4: "Loran-C",
  5: "Chayka",
  6: "Système de navigation intégré",
  7: "Relevé (fixe)",
  8: "Galileo",
};

function epfdLabel(code) {
  return EPFD_LABELS[code] ?? "Inconnu";
}

// Extrait les champs propres à un message AIS type 4 (station de base),
// avec repli sur plusieurs casses possibles selon la source.
function parseBaseStationReport(data) {
  const meta = data.MetaData || {};
  const report = data.Message?.BaseStationReport;
  if (!report) return null;

  const mmsi = meta.MMSI ?? meta.Mmsi ?? report.UserID;
  const lat = meta.latitude ?? meta.Latitude ?? report.Latitude ?? report.latitude;
  const lon = meta.longitude ?? meta.Longitude ?? report.Longitude ?? report.longitude;
  if (!mmsi || lat === undefined || lon === undefined) return null;

  const epfd = report.Epfd ?? report.EPFD ?? report.FixType ?? report.Type;
  const raim = report.Raim ?? report.RAIM ?? report.RaimFlag;

  // Une station de base AIS ne diffuse pas de nom (norme AIS type 4) ; ce
  // champ n'est renseigné que si AISStream l'associe à ce MMSI par ailleurs.
  const name = meta.ShipName ? meta.ShipName.trim() : null;

  const year = report.UtcYear ?? report.Year;
  const month = report.UtcMonth ?? report.Month;
  const day = report.UtcDay ?? report.Day;
  const hour = report.UtcHour ?? report.Hour;
  const minute = report.UtcMinute ?? report.Minute;
  const second = report.UtcSecond ?? report.Second;
  let stationUtc = null;
  if ([year, month, day, hour, minute].every((v) => v !== undefined)) {
    stationUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second ?? 0));
  }

  return { mmsi, lat, lon, epfd, raim, stationUtc, name };
}

// Distance orthodromique (km) entre deux points — sert uniquement à estimer
// les navires "à proximité" d'une station, faute de lien direct dans les
// données AIS entre un message navire et la station qui l'a reçu.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
