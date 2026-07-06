// Configuration globale de l'application AIS Tracker

const AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream";

// Zone pré-remplie au premier lancement ; entièrement modifiable par
// l'utilisateur avant de se connecter (voir le formulaire de connexion).
const DEFAULT_ZONE = {
  north: 53.5,
  south: 48.3,
  west: -7,
  east: 7,
};

// Zoom à partir duquel les navires sont affichés individuellement.
// En-dessous de ce niveau, les navires sont agrégés (cluster + compteur).
const CLUSTER_DISABLE_ZOOM = 8;

const STALE_VESSEL_MS = 15 * 60 * 1000; // 15 min sans mise à jour -> retrait
const STALE_CHECK_INTERVAL_MS = 60 * 1000;

// AIS ne relie pas un message navire à la station qui l'a reçu : ce rayon
// sert uniquement à estimer les navires "à proximité" d'une station (portée
// VHF/AIS typique), ce n'est pas une donnée de réception réelle.
const STATION_PROXIMITY_RADIUS_KM = 74; // ~40 milles nautiques

const STORAGE_KEY_API = "aisstream_api_key";
const STORAGE_KEY_ZONE = "aisstream_zone";
const STORAGE_KEY_AGGREGATION = "aisstream_aggregation";
const STORAGE_KEY_SHOW_STATIONS = "aisstream_show_stations";

const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30000;
