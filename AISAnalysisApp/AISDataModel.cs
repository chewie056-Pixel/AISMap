using System.Collections.Generic;

namespace AISAnalysisApp
{
    public class ChartDataPoint
    {
        public string TimeLabel { get; set; }
        public int BoatCount { get; set; }
    }

    public class AnalysisResult
    {
        public List<ChartDataPoint> DataPoints { get; set; } = new List<ChartDataPoint>();
        public int TotalUniqueBoats { get; set; }
        public int MaxBoats { get; set; }
        public double AverageBoats { get; set; }
        public string Duration { get; set; }
        public string StartTime { get; set; }
        public string EndTime { get; set; }
    }

    public enum AggregationType
    {
        Hour,
        Minutes30,
        Minutes10,
        Minutes2
    }
}
