// Classification des navires à partir du code AIS "ShipType" (0-99)

const SHIP_CATEGORIES = {
  cargo: { label: "Cargo", color: "#2E86DE" },
  tanker: { label: "Pétrolier / Citerne", color: "#E67E22" },
  passenger: { label: "Passagers", color: "#27AE60" },
  fishing: { label: "Pêche", color: "#E74C3C" },
  pleasure: { label: "Plaisance / Voile", color: "#9B59B6" },
  special: { label: "Remorqueur / Spécial", color: "#F1C40F" },
  highspeed: { label: "Engin rapide", color: "#16A085" },
  other: { label: "Autre", color: "#7F8C8D" },
  unknown: { label: "Inconnu", color: "#BDC3C7" },
};

function categorizeShipType(typeCode) {
  if (typeCode === undefined || typeCode === null || typeCode === 0) {
    return "unknown";
  }
  if (typeCode >= 20 && typeCode <= 29) return "special";
  if (typeCode === 30) return "fishing";
  if ([31, 32, 52].includes(typeCode)) return "special";
  if (typeCode >= 33 && typeCode <= 35) return "special";
  if (typeCode === 36 || typeCode === 37) return "pleasure";
  if (typeCode >= 40 && typeCode <= 49) return "highspeed";
  if (typeCode >= 50 && typeCode <= 59) return "special";
  if (typeCode >= 60 && typeCode <= 69) return "passenger";
  if (typeCode >= 70 && typeCode <= 79) return "cargo";
  if (typeCode >= 80 && typeCode <= 89) return "tanker";
  if (typeCode >= 90 && typeCode <= 99) return "other";
  return "unknown";
}

const NAV_STATUS_LABELS = {
  0: "En route (moteur)",
  1: "Au mouillage",
  2: "Sans commande",
  3: "Manœuvrabilité réduite",
  4: "Contrainte de tirant d'eau",
  5: "Amarré",
  6: "Échoué",
  7: "En pêche",
  8: "En route (voile)",
  15: "Non défini",
};

function navStatusLabel(code) {
  return NAV_STATUS_LABELS[code] ?? "Statut inconnu";
}
