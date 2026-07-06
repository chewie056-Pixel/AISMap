// Configuration globale de l'application AIS Tracker

const AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream";

// Zone pré-remplie au premier lancement ; entièrement modifiable par
// l'utilisateur avant de se connecter (voir le formulaire de connexion).
const DEFAULT_ZONE = {
  north: 53.5,
  south: 48.3,
  west: -7.5,
  east: 7,
};

// Zoom à partir duquel les navires sont affichés individuellement.
// En-dessous de ce niveau, les navires sont agrégés (cluster + compteur).
const CLUSTER_DISABLE_ZOOM = 8;

const STALE_VESSEL_MS = 15 * 60 * 1000; // 15 min sans mise à jour -> retrait
const STALE_CHECK_INTERVAL_MS = 60 * 1000;

const STORAGE_KEY_API = "aisstream_api_key";
const STORAGE_KEY_ZONE = "aisstream_zone";

const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30000;
