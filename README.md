# AIS Tracker

Application web (front-end pur, sans backend) qui se connecte en direct au
flux AIS de [AISStream.io](https://aisstream.io) via WebSocket et affiche les
positions des navires sur une carte mondiale, dans une zone géographique
définie par l'utilisateur.

## Fonctionnalités

- **Connexion AISStream.io** : entrez votre clé API personnelle (créée
  gratuitement sur aisstream.io) directement dans l'application. La
  connexion WebSocket se fait depuis le navigateur, la clé peut être
  mémorisée localement (localStorage).
- **Zone géographique définie par l'utilisateur** : au premier lancement,
  l'application demande une zone (boîte englobante Nord/Sud/Ouest/Est) en
  plus de la clé API. Aucune zone n'est présélectionnée : c'est cette zone
  qui détermine la souscription AISStream et les navires affichés. Elle est
  modifiable à tout moment soit par valeurs numériques (bouton **⚙︎ Zone**),
  soit en la **dessinant directement sur la carte** (bouton **✏️ Dessiner
  zone** : cliquez-glissez pour tracer le nouveau rectangle, Échap pour
  annuler). Dans les deux cas, si une connexion est active elle est
  automatiquement relancée avec la nouvelle zone.
- **Carte mondiale** avec la zone surveillée encadrée par un rectangle.
- **Affichage adaptatif selon le zoom** :
  - zoom ≥ 8 : chaque navire est affiché individuellement (triangle orienté
    selon son cap/heading, coloré selon son type).
  - zoom < 8 : les navires sont agrégés en clusters affichant uniquement le
    nombre de navires regroupés.
- **Légende dynamique** (bas gauche) : répartition de la flotte visible par
  catégorie (Cargo, Pétrolier, Passagers, Pêche, Plaisance, etc.) et nombre
  total de navires actuellement dans la vue.
- Reconnexion automatique avec backoff exponentiel en cas de coupure, et
  purge des navires n'ayant pas émis depuis 15 minutes.
- **Agrégation activable/désactivable** : un interrupteur dans le bandeau
  permet de forcer l'affichage individuel de tous les navires, quel que soit
  le zoom.
- **Page « Stations »** (`stations.html`, lien 📡 dans le bandeau) : liste les
  stations AIS de base (balises côtières/terrestres, messages *Base Station
  Report*) qui émettent dans la zone configurée sur la page principale, avec
  leurs caractéristiques (type de positionnement EPFD, RAIM, heure UTC de la
  station, nom si AISStream l'associe au MMSI) et une estimation du nombre de
  navires suivis à proximité (rayon configurable, `STATION_PROXIMITY_RADIUS_KM`
  dans `js/config.js`).
  ⚠️ L'AIS ne relie pas un message navire à la station qui l'a reçu : ce
  nombre est une estimation géographique, pas un décompte réel de réception.
  Cette page n'ouvre **pas** sa propre connexion : elle affiche les données
  reçues par la page principale (ouverte et connectée dans un autre onglet),
  relayées via `BroadcastChannel` — voir la note ci-dessous sur les
  connexions multiples.
- **Stations sur la carte principale** : un interrupteur dans le bandeau
  permet d'afficher les stations de base directement sur la carte (icône 📡
  distincte des navires), avec le détail au clic.
- **Reconnaissance des navires Classe B** : en plus du message type 5
  (`ShipStaticData`, navires Classe A), l'application comprend le message
  type 24 (`StaticDataReport`, en deux parties nom/type) utilisé par les
  navires Classe B (plaisance, pêche, petites unités), pour leur attribuer
  un nom et une catégorie dans la légende.

## Lancer l'application

Aucune dépendance ni build n'est nécessaire : c'est une application statique
(HTML/CSS/JS + Leaflet, embarqué localement dans `vendor/`, aucun CDN externe
requis). Servez simplement le dossier avec un serveur statique quelconque,
par exemple :

```bash
npx serve .
# ou
python3 -m http.server 8080
```

Puis ouvrez `http://localhost:8080` (ou le port indiqué) dans votre
navigateur. Au premier lancement, renseignez votre clé API AISStream.io
ainsi que la zone géographique (Nord/Sud/Ouest/Est, en degrés décimaux) que
vous souhaitez surveiller.

> Le fichier peut aussi être ouvert directement (`index.html`) dans la
> plupart des navigateurs, mais un serveur local est recommandé pour éviter
> d'éventuelles restrictions liées au protocole `file://`.

## Structure

```
index.html        Page principale (carte, panneau de connexion, légende)
stations.html      Page listant les stations AIS de base de la zone
css/style.css      Styles de l'interface
css/stations.css   Styles spécifiques à la page Stations
js/config.js       Constantes (seuils de zoom, clés de stockage, etc.)
js/shipTypes.js    Classification des types de navires AIS et couleurs
js/ws-utils.js     Décodage partagé des messages WebSocket AISStream
js/app.js          Logique principale : seule connexion WebSocket réelle,
                   carte Leaflet, gestion de la zone, clustering, légende,
                   diffusion des données via BroadcastChannel
js/stations.js     Page Stations : reçoit les données via BroadcastChannel
                   (n'ouvre pas de connexion WebSocket propre)
vendor/            Leaflet + Leaflet.markercluster embarqués (pas de CDN)
```

## Notes sur AISStream.io

- Le message de souscription envoyé à l'ouverture du WebSocket reprend la
  zone saisie par l'utilisateur, par exemple :
  ```json
  {
    "APIKey": "VOTRE_CLE",
    "BoundingBoxes": [[[SUD, OUEST], [NORD, EST]]],
    "FilterMessageTypes": [
      "PositionReport", "StandardClassBPositionReport",
      "ShipStaticData", "StaticDataReport", "BaseStationReport"
    ]
  }
  ```
- **Une seule connexion WebSocket par session de navigation.** AISStream
  ferme les connexions de façon abrupte (code `1006`, sans raison) dès que
  plusieurs onglets ouvrent chacun leur propre connexion avec la même clé
  API. La page principale (`index.html`) est donc la seule à appeler
  `new WebSocket(...)` ; elle diffuse chaque message reçu, changement de
  statut et changement de zone via `BroadcastChannel("aistracker")`. La page
  Stations s'abonne à ce canal au lieu d'ouvrir sa propre connexion, et
  affiche un message si aucune page principale connectée n'est détectée
  après quelques secondes.
- `PositionReport` / `StandardClassBPositionReport` fournissent la position,
  la vitesse (SOG), le cap (COG) et le cap vrai (heading).
- `ShipStaticData` (type 5, navires Classe A) et `StaticDataReport` (type 24,
  navires Classe B, en deux parties) fournissent le nom et le type de navire
  (code AIS 0–99), utilisés pour la catégorisation et la légende.
- `BaseStationReport` (message AIS type 4) fournit la position des stations
  de base émettant dans la zone.
- La clé API n'est jamais envoyée à un serveur tiers : elle est utilisée
  uniquement pour la connexion WebSocket directe entre votre navigateur et
  AISStream.io.
