# AISAnalysisApp

Application WPF (.NET 8) d'analyse de fichiers JSON de détections AIS, avec graphique **OxyPlot**.

## Structure

```
AISAnalysisApp/
├── AISAnalysisApp.csproj   # Projet (package OxyPlot.Wpf)
├── App.xaml / App.xaml.cs
├── MainWindow.xaml         # Interface (PlotView OxyPlot)
├── MainWindow.xaml.cs      # Code-behind (création du PlotModel)
├── AISDataAnalyzer.cs      # Parsing JSON + agrégation + stats
└── AISDataModel.cs         # Modèles de données
```

## Compilation

```bash
dotnet build
```

## Utilisation

1. Lancer l'application (`dotnet run`)
2. **Charger JSON** : sélectionner un fichier de détections AIS
3. **Analyser** : génère le graphique et les statistiques
4. Choisir l'agrégation (heure / 30 min / 10 min / 2 min) et le type (barres / ligne), puis **Mettre à jour**

## Format JSON attendu

Tableau de détections, formats acceptés pour chaque élément :

```json
[
  { "t": 1717000000000, "data": { "MetaData": { "MMSI": 123456789, "time_utc": "2024-05-29T12:00:00Z" } } }
]
```

Champs alternatifs acceptés : `timestamp`, `time`, `date`, `detectionTime`, et `MMSI` à la racine.

## Graphique

- **Barres** ou **Ligne** (lissée)
- Axe X : temps écoulé depuis le début de l'enregistrement (offset)
- Axe Y : nombre de bateaux uniques (MMSI distincts) par période
- Zoom molette, pan clic droit, tracker au survol
- Les buckets vides sont affichés à 0 pour préserver la continuité temporelle

## Export PNG

```csharp
PngExporter.Export(chart.Model, "analyse.png", 1200, 600);
```
