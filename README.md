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
  modifiable à tout moment via le bouton **⚙︎ Zone**.
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
css/style.css      Styles de l'interface
js/config.js       Constantes (seuils de zoom, clés de stockage, etc.)
js/shipTypes.js    Classification des types de navires AIS et couleurs
js/app.js          Logique principale : WebSocket AISStream, carte Leaflet,
                   gestion de la zone, clustering, légende
vendor/            Leaflet + Leaflet.markercluster embarqués (pas de CDN)
```

## Notes sur AISStream.io

- Le message de souscription envoyé à l'ouverture du WebSocket reprend la
  zone saisie par l'utilisateur, par exemple :
  ```json
  {
    "APIKey": "VOTRE_CLE",
    "BoundingBoxes": [[[SUD, OUEST], [NORD, EST]]],
    "FilterMessageTypes": ["PositionReport", "ShipStaticData"]
  }
  ```
- `PositionReport` fournit la position, la vitesse (SOG), le cap (COG) et le
  cap vrai (heading).
- `ShipStaticData` fournit le nom et le type de navire (code AIS 0–99), utilisé
  pour la catégorisation et la légende.
- La clé API n'est jamais envoyée à un serveur tiers : elle est utilisée
  uniquement pour la connexion WebSocket directe entre votre navigateur et
  AISStream.io.
