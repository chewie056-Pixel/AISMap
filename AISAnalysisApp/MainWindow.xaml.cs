using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using OxyPlot;
using OxyPlot.Axes;
using OxyPlot.Series;

namespace AISAnalysisApp
{
    public partial class MainWindow : Window
    {
        private List<AISDataAnalyzer.AISDetection> _detections;
        private AnalysisResult _currentResult;
        private readonly OxyPlot.Wpf.PlotView _plotView;

        public MainWindow()
        {
            InitializeComponent();

            // PlotView créé par code pour éviter le chargement ReflectionOnly
            // des assemblages OxyPlot par le compilateur XAML (markup compiler)
            _plotView = new OxyPlot.Wpf.PlotView();
            chartHost.Child = _plotView;
        }

        private void LoadJson_Click(object sender, RoutedEventArgs e)
        {
            var openFileDialog = new Microsoft.Win32.OpenFileDialog
            {
                Title = "Sélectionner un fichier JSON AIS",
                Filter = "Fichiers JSON (*.json)|*.json|Tous les fichiers (*.*)|*.*",
                FilterIndex = 1,
                Multiselect = false
            };

            if (openFileDialog.ShowDialog() == true)
            {
                try
                {
                    _detections = AISDataAnalyzer.ParseAISFile(openFileDialog.FileName);
                    txtFileName.Text = Path.GetFileName(openFileDialog.FileName);
                    btnAnalyze.IsEnabled = true;
                }
                catch (Exception ex)
                {
                    MessageBox.Show($"Erreur de chargement : {ex.Message}", "Erreur",
                                    MessageBoxButton.OK, MessageBoxImage.Error);
                }
            }
        }

        private void Analyze_Click(object sender, RoutedEventArgs e)
        {
            if (_detections == null || _detections.Count == 0)
                return;

            RunAnalysis();
        }

        private void UpdateChart_Click(object sender, RoutedEventArgs e)
        {
            if (_detections == null || _detections.Count == 0)
                return;

            RunAnalysis();
        }

        private void RunAnalysis()
        {
            var aggregationType = GetSelectedAggregation();
            var period = GetTimeSpanFromAggregation(aggregationType);

            _currentResult = AnalyzeData(aggregationType, period);
            UpdateUI();
            UpdateChart();
        }

        private AggregationType GetSelectedAggregation()
        {
            var selectedItem = cmbAggregation.SelectedItem as ComboBoxItem;
            switch (selectedItem?.Tag?.ToString())
            {
                case "Hour": return AggregationType.Hour;
                case "Minutes30": return AggregationType.Minutes30;
                case "Minutes10": return AggregationType.Minutes10;
                case "Minutes2": return AggregationType.Minutes2;
                default: return AggregationType.Minutes10;
            }
        }

        private TimeSpan GetTimeSpanFromAggregation(AggregationType type)
        {
            switch (type)
            {
                case AggregationType.Hour: return TimeSpan.FromHours(1);
                case AggregationType.Minutes30: return TimeSpan.FromMinutes(30);
                case AggregationType.Minutes10: return TimeSpan.FromMinutes(10);
                case AggregationType.Minutes2: return TimeSpan.FromMinutes(2);
                default: return TimeSpan.FromMinutes(10);
            }
        }

        private AnalysisResult AnalyzeData(AggregationType aggregationType, TimeSpan period)
        {
            var aggregated = AISDataAnalyzer.AggregateByPeriod(_detections, period);
            var stats = AISDataAnalyzer.CalculateStats(_detections);

            var dataPoints = aggregated.Select(item => new ChartDataPoint
            {
                TimeLabel = item.PeriodLabel,
                BoatCount = item.UniqueBoatCount
            }).ToList();

            var counts = aggregated.Select(a => a.UniqueBoatCount).ToList();

            return new AnalysisResult
            {
                DataPoints = dataPoints,
                TotalUniqueBoats = stats.TotalUniqueBoats,
                MaxBoats = counts.Count > 0 ? counts.Max() : 0,
                AverageBoats = counts.Count > 0 ? counts.Average() : 0,
                Duration = $"{stats.TotalDuration.TotalHours:F1}h",
                StartTime = stats.RecordingStart.ToString("yyyy-MM-dd HH:mm:ss"),
                EndTime = stats.RecordingEnd.ToString("yyyy-MM-dd HH:mm:ss")
            };
        }

        private void UpdateUI()
        {
            if (_currentResult == null) return;

            txtTotalBoats.Text = _currentResult.TotalUniqueBoats.ToString();
            txtMaxBoats.Text = _currentResult.MaxBoats.ToString();
            txtAvgBoats.Text = _currentResult.AverageBoats.ToString("F1");
            txtDuration.Text = _currentResult.Duration;
        }

        private void UpdateChart()
        {
            if (_currentResult == null || _currentResult.DataPoints.Count == 0)
            {
                _plotView.Model = null;
                return;
            }

            var chartType = (cmbChartType.SelectedItem as ComboBoxItem)?.Tag?.ToString();
            var isBarChart = chartType == "Bar";

            var plotModel = new PlotModel
            {
                Title = "Bateaux uniques par période",
                LegendPlacement = LegendPlacement.Inside,
                LegendPosition = LegendPosition.TopRight,
                LegendBackground = OxyColor.FromAColor(200, OxyColors.White),
                LegendBorder = OxyColors.Black
            };

            var categoryAxis = new CategoryAxis
            {
                Position = AxisPosition.Bottom,
                Title = "Temps écoulé",
                MajorTickSize = 0,
                Angle = _currentResult.DataPoints.Count > 20 ? -45 : 0
            };
            categoryAxis.Labels.AddRange(_currentResult.DataPoints.Select(dp => dp.TimeLabel));

            var valueAxis = new LinearAxis
            {
                Position = AxisPosition.Left,
                Title = "Nombre de bateaux",
                Minimum = 0,
                MinimumPadding = 0,
                MajorStep = 1,
                MinorStep = 1
            };

            if (isBarChart)
            {
                var columnSeries = new ColumnSeries
                {
                    Title = "Bateaux uniques",
                    FillColor = OxyColor.FromAColor(160, OxyColors.SteelBlue),
                    StrokeColor = OxyColors.SteelBlue,
                    StrokeThickness = 1
                };

                foreach (var dp in _currentResult.DataPoints)
                    columnSeries.Items.Add(new ColumnItem(dp.BoatCount));

                plotModel.Series.Add(columnSeries);
            }
            else
            {
                var lineSeries = new LineSeries
                {
                    Title = "Bateaux uniques",
                    Color = OxyColors.SteelBlue,
                    StrokeThickness = 2,
                    MarkerType = MarkerType.Circle,
                    MarkerSize = 4,
                    MarkerFill = OxyColors.SteelBlue,
                    MarkerStroke = OxyColors.White
                };

                for (int i = 0; i < _currentResult.DataPoints.Count; i++)
                    lineSeries.Points.Add(new DataPoint(i, _currentResult.DataPoints[i].BoatCount));

                plotModel.Series.Add(lineSeries);
            }

            plotModel.Axes.Add(categoryAxis);
            plotModel.Axes.Add(valueAxis);

            _plotView.Model = plotModel;
        }
    }
}
