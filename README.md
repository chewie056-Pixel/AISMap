# AIS Tracker

Application de suivi maritime en direct à partir du flux AIS de
[AISStream.io](https://aisstream.io). Un petit serveur local Node.js détient
l'unique connexion AISStream (persistante, indépendante des onglets ouverts),
peut l'enregistrer sur disque (CSV ou JSON) et la rejouer à vitesse variable ;
le navigateur affiche tout ça sur une carte Leaflet.

## Fonctionnalités

- **Connexion AISStream.io côté serveur** : entrez votre clé API (créée
  gratuitement sur aisstream.io) une seule fois depuis le navigateur ; le
  serveur la persiste (`server/config.json`) et maintient la connexion en
  continu, **indépendamment des onglets/navigateurs ouverts** — fermer la
  page ou perdre la connexion réseau du navigateur n'interrompt ni le flux
  AIS côté serveur, ni un enregistrement en cours.
- **Zone géographique définie par l'utilisateur** : boîte englobante
  Nord/Sud/Ouest/Est, modifiable à tout moment depuis le menu **🗺️ Carte**
  (valeurs numériques ou dessin direct sur la carte). Le serveur reconnecte
  automatiquement AISStream sur la nouvelle zone.
- **Carte mondiale** avec la zone surveillée encadrée par un rectangle,
  affichage adaptatif selon le zoom (navires individuels au-delà d'un seuil,
  agrégés en-deçà), légende dynamique (flotte par catégorie, stations et
  aides à la navigation visibles).
- **Enregistrement du flux côté serveur** (page `recording.html`, lien
  ⏺ Enregistrement) : démarrer/arrêter un enregistrement en **CSV** ou
  **JSON**, avec l'état courant (idle/en cours, durée, nombre de messages)
  visible en direct sur toutes les pages ouvertes (indicateur ⏺ REC sur la
  carte). Les fichiers sont stockés dans `server/recordings/` et restent
  valides même en cas d'arrêt brutal du serveur (réparation automatique au
  redémarrage).
- **Rejeu à vitesse variable (x1 à x20)** : depuis la liste des
  enregistrements, lancez un rejeu qui s'affiche sur la carte principale
  exactement comme le direct (mêmes marqueurs, légende, clustering), avec
  play/pause/stop et réglage de vitesse en direct, synchronisés entre tous
  les onglets ouverts.
- **Page « Stations »** (`stations.html`) : liste les stations AIS de base
  (*Base Station Report*, message type 4) de la zone, avec leurs
  caractéristiques (EPFD, RAIM, heure UTC) et une estimation du nombre de
  navires suivis à proximité (l'AIS ne relie pas un message navire à la
  station qui l'a reçu — c'est une estimation géographique, pas un décompte
  réel de réception).
- **Aides à la navigation (AtoN)** et **messages de sécurité** (*Safety
  Broadcast*) : bouées/phares/balises affichables sur la carte, panneau de
  messages de sécurité apparaissant automatiquement à réception.
- **Reconnaissance étendue des navires** : `ShipStaticData` (type 5, Classe
  A), `StaticDataReport` (type 24, Classe B, deux parties) et
  `ExtendedClassBPositionReport` (type 19, position + nom/type en un seul
  message) pour attribuer nom et catégorie à un maximum de navires.

## Lancer l'application

Contrairement aux versions précédentes, l'application **nécessite le serveur
Node.js** (le navigateur ne se connecte plus jamais directement à
AISStream.io) :

```bash
cd server
npm install
npm start          # ou : node server.js
```

Puis ouvrez `http://localhost:8383` dans votre navigateur (port modifiable
via la variable d'environnement `PORT`). Le serveur sert directement les
pages HTML/CSS/JS : pas besoin d'un second serveur statique.

Au premier lancement, renseignez votre clé API AISStream.io ainsi que la
zone géographique à surveiller : ces informations sont envoyées au serveur
et persistées dans `server/config.json` (fichier local, jamais commité —
voir `.gitignore`). Aux lancements suivants, le serveur reconnecte
automatiquement AISStream avec la configuration déjà enregistrée.

> Le serveur doit rester **en cours d'exécution** (`node server.js`) pour
> que le suivi en direct, l'enregistrement et le rejeu fonctionnent. Il peut
> tourner en local sur votre machine ou sur un serveur/VPS que vous
> possédez.

## Structure

```
index.html          Page principale (carte, panneau de connexion, légende)
stations.html        Page listant les stations AIS de base de la zone
recording.html        Page de gestion de l'enregistrement et du rejeu
css/style.css        Styles de l'interface principale
css/stations.css      Styles partagés stations/enregistrement (panneaux, tableaux)
css/recording.css     Styles spécifiques à la page Enregistrement
js/config.js          Constantes (URL du serveur local, seuils, clés de stockage)
js/shipTypes.js       Classification des types de navires AIS et couleurs
js/ws-utils.js        Décodage des messages WebSocket, échappement HTML, parseurs
js/app.js             Carte principale : connexion au serveur local, rendu
                      Leaflet, mode rejeu
js/stations.js        Page Stations (connexion directe au serveur local)
js/recording.js       Page Enregistrement (connexion + API REST du serveur)
vendor/               Leaflet + Leaflet.markercluster embarqués (pas de CDN)

server/package.json   Dépendances du serveur (ws)
server/server.js       Serveur HTTP (sert le frontend + API REST) et WebSocket
                      (relaie AIS/statut/enregistrement/rejeu à tous les onglets)
server/aisRelay.js     Unique connexion AISStream persistante, config
                      (server/config.json), reconnexion automatique
server/recorder.js     Enregistrement CSV/JSON incrémental, métadonnées,
                      réparation après arrêt brutal
server/replay.js        Moteur de rejeu (vitesse x1-x20, play/pause/stop)
server/recordings/      Fichiers enregistrés (ignorés par git)
```

## Architecture : pourquoi un serveur ?

AISStream ferme les connexions de façon abrupte (code `1006`, sans raison)
dès que **plusieurs connexions WebSocket utilisent la même clé API en même
temps** — ce qui arrivait dès que deux onglets se connectaient chacun
directement. Le serveur local résout ce problème définitivement : il est le
seul à ouvrir une connexion à AISStream (`server/aisRelay.js`), et la relaie
à tous les onglets navigateur connectés (`index.html`, `stations.html`,
`recording.html`) via son propre WebSocket (`ws://.../ws`). Cette même
architecture permet :

- l'**enregistrement** indépendant du navigateur (le serveur écrit sur
  disque, que des onglets soient ouverts ou non) ;
- le **rejeu** partagé et synchronisé entre tous les onglets (statut,
  progression et vitesse diffusés à tous) ;
- une **reprise automatique** après un redémarrage du serveur (la
  configuration API key/zone est persistée, la connexion AISStream se
  rétablit seule).

## Notes sur AISStream.io

- Le message de souscription envoyé par le serveur à l'ouverture de la
  connexion AISStream :
  ```json
  {
    "APIKey": "VOTRE_CLE",
    "BoundingBoxes": [[[SUD, OUEST], [NORD, EST]]],
    "FilterMessageTypes": [
      "PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport",
      "ShipStaticData", "StaticDataReport", "BaseStationReport",
      "AidsToNavigationReport", "SafetyBroadcastMessage"
    ]
  }
  ```
- `PositionReport` / `StandardClassBPositionReport` fournissent la position,
  la vitesse (SOG), le cap (COG) et le cap vrai (heading). Les navires Classe
  B (`StandardClassBPositionReport` / `ExtendedClassBPositionReport`) ne
  transmettent jamais de statut de navigation (norme AIS) : l'application
  affiche alors « Non transmis (Classe B) » plutôt qu'un générique « inconnu »
  qui laisserait penser à une donnée manquante.
- `ExtendedClassBPositionReport` (type 19) fournit position et nom/type en un
  seul message (navires Classe B qui n'émettent pas de `StaticDataReport`
  séparé).
- `ShipStaticData` (type 5, navires Classe A) et `StaticDataReport` (type 24,
  navires Classe B, en deux parties) fournissent le nom et le type de navire
  (code AIS 0–99), utilisés pour la catégorisation et la légende.
- `BaseStationReport` (message AIS type 4) fournit la position des stations
  de base émettant dans la zone.
- `AidsToNavigationReport` (type 21) fournit la position, le nom et le type
  des bouées/phares/balises AIS de la zone.
- `SafetyBroadcastMessage` (type 14) fournit le texte des messages de
  sécurité diffusés dans la zone. Provenant d'une diffusion externe non
  fiable, ce texte (ainsi que les noms de navires/stations) est
  systématiquement échappé avant affichage (voir `escapeHtml` dans
  `js/ws-utils.js`).
- La clé API n'est envoyée qu'au serveur local (jamais à un tiers), qui
  l'utilise pour l'unique connexion WebSocket vers AISStream.io.

## Enregistrements (CSV / JSON)

- **JSON** : tableau d'objets `{ "t": <timestamp ms>, "data": <message AIS
  original> }`, un par message reçu.
- **CSV** : colonnes usuelles (horodatage, type de message, MMSI, position,
  vitesse/cap, nom, type) plus une colonne `raw_json` contenant le message
  AIS complet, pour ne perdre aucune information.
- Chaque enregistrement a un fichier `<id>.meta.json` associé (format, heure
  de début/fin, nombre de messages, complétude) utilisé pour la liste, le
  téléchargement et le rejeu.
