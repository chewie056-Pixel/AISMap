# AIS Tracker — Brésil

Application web (front-end pur, sans backend) qui se connecte en direct au
flux AIS de [AISStream.io](https://aisstream.io) via WebSocket et affiche les
positions des navires au large du Brésil sur une carte mondiale.

## Fonctionnalités

- **Connexion AISStream.io** : entrez votre clé API personnelle (créée
  gratuitement sur aisstream.io) directement dans l'application. La
  connexion WebSocket se fait depuis le navigateur, la clé peut être
  mémorisée localement (localStorage).
- **Carte mondiale** avec la zone surveillée (façade atlantique du Brésil)
  encadrée par un rectangle. La zone est ajustable via le bouton **⚙︎ Zone**.
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
navigateur.

> Le fichier peut aussi être ouvert directement (`index.html`) dans la
> plupart des navigateurs, mais un serveur local est recommandé pour éviter
> d'éventuelles restrictions liées au protocole `file://`.

## Structure

```
index.html        Page principale (carte, panneau de connexion, légende)
css/style.css      Styles de l'interface
js/config.js       Constantes (zone par défaut, seuils de zoom, etc.)
js/shipTypes.js    Classification des types de navires AIS et couleurs
js/app.js          Logique principale : WebSocket AISStream, carte Leaflet,
                   clustering, légende
vendor/            Leaflet + Leaflet.markercluster embarqués (pas de CDN)
```

## Notes sur AISStream.io

- Le message de souscription envoyé à l'ouverture du WebSocket est de la
  forme :
  ```json
  {
    "APIKey": "VOTRE_CLE",
    "BoundingBoxes": [[[-35, -54], [6, -28]]],
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
