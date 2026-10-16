# AISAnalysisApp

Application WPF (.NET Framework 4.8) d'analyse de fichiers JSON de détections AIS, avec graphique **OxyPlot 2014.1.546**.

## Structure

```
AISAnalysisApp/
├── AISAnalysisApp.csproj   # Projet .NET Framework 4.8 (packages.config)
├── App.xaml / App.xaml.cs
├── MainWindow.xaml         # Interface (PlotView OxyPlot)
├── MainWindow.xaml.cs      # Code-behind (création du PlotModel)
├── AISDataAnalyzer.cs      # Parsing JSON + agrégation + stats
└── AISDataModel.cs         # Modèles de données
```

## Compilation

Ouvrir `AISAnalysisApp.csproj` dans Visual Studio, restaurer les packages NuGet (OxyPlot 2014.1.546 + Newtonsoft.Json), puis Build.

## Utilisation

1. Lancer l'application (F5 dans Visual Studio)
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
var pngExporter = new OxyPlot.WindowsForms.PngExporter { Width = 1200, Height = 600 };
// En 2014.1.546, l'export PNG se fait via :
// OxyPlot.Wpf.PngExporter.Export(chart.Model, "analyse.png", 1200, 600);
```
