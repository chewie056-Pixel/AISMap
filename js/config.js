// Configuration globale de l'application AIS Tracker

const AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream";

// Zone par défaut : au large du Brésil (façade atlantique)
const DEFAULT_ZONE = {
  north: 6,
  south: -35,
  west: -54,
  east: -28,
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
