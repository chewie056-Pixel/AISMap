using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace AISAnalysisApp
{
    public class AISDataAnalyzer
    {
        public class AISDetection
        {
            public DateTime Timestamp { get; set; }
            public string MMSI { get; set; }
        }

        public class AggregatedPeriod
        {
            public string PeriodLabel { get; set; }
            public int UniqueBoatCount { get; set; }
            public double OffsetSeconds { get; set; }
            public DateTime PeriodTime { get; set; }
        }

        public class AISStats
        {
            public int TotalUniqueBoats { get; set; }
            public int MaxBoatsInPeriod { get; set; }
            public double AverageBoats { get; set; }
            public TimeSpan TotalDuration { get; set; }
            public DateTime RecordingStart { get; set; }
            public DateTime RecordingEnd { get; set; }
        }

        public static List<AISDetection> ParseAISFile(string filePath)
        {
            var root = JToken.Parse(File.ReadAllText(filePath));

            if (!(root is JArray))
                throw new InvalidDataException("Le fichier JSON doit contenir un tableau de d\u00e9tections");

            var detections = new List<AISDetection>();

            foreach (var element in (JArray)root)
            {
                var timestamp = ExtractTimestamp(element);
                var mmsi = ExtractMMSI(element);

                if (timestamp == null || string.IsNullOrEmpty(mmsi))
                    continue;

                detections.Add(new AISDetection
                {
                    Timestamp = timestamp.Value,
                    MMSI = mmsi
                });
            }

            if (detections.Count == 0)
                throw new InvalidDataException("Aucune d\u00e9tection valide (timestamp + MMSI) trouv\u00e9e");

            return detections;
        }

        private static DateTime? ExtractTimestamp(JToken element)
        {
            // Format principal : { "t": ... }
            var t = element["t"];
            if (t != null)
            {
                var date = TryParseDate(t);
                if (date.HasValue) return date;
            }

            // Format AISMap : { "data": { "MetaData": { "time_utc": ... } } }
            var timeUtc = element.SelectToken("data.MetaData.time_utc");
            if (timeUtc != null)
            {
                var date = TryParseDate(timeUtc);
                if (date.HasValue) return date;
            }

            // Formats alternatifs
            string[] altKeys = { "timestamp", "time", "date", "detectionTime" };
            foreach (var key in altKeys)
            {
                var prop = element[key];
                if (prop != null)
                {
                    var date = TryParseDate(prop);
                    if (date.HasValue) return date;
                }
            }

            return null;
        }

        private static string ExtractMMSI(JToken element)
        {
            var mmsi = element.SelectToken("data.MetaData.MMSI");
            if (mmsi == null)
                mmsi = element["MMSI"];

            if (mmsi == null)
                return null;

            return mmsi.Type == JTokenType.Integer
                ? mmsi.Value<long>().ToString()
                : mmsi.ToString();
        }

        private static DateTime? TryParseDate(JToken token)
        {
            try
            {
                if (token.Type == JTokenType.Integer)
                {
                    // Timestamp Unix (secondes ou millisecondes)
                    var value = token.Value<long>();
                    var epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                    return value > 100000000000
                        ? epoch.AddMilliseconds(value)
                        : epoch.AddSeconds(value);
                }

                var raw = token.ToString();
                if (string.IsNullOrEmpty(raw))
                    return null;

                DateTime date;
                if (DateTime.TryParse(raw, out date))
                    return date;

                return null;
            }
            catch
            {
                return null;
            }
        }

        public static List<AggregatedPeriod> AggregateByPeriod(List<AISDetection> detections, TimeSpan period)
        {
            if (detections == null || detections.Count == 0)
                return new List<AggregatedPeriod>();

            var reference = detections.Min(d => d.Timestamp);
            var periodMinutes = period.TotalMinutes;

            var buckets = detections
                .GroupBy(d => (long)Math.Floor((d.Timestamp - reference).TotalMinutes / periodMinutes))
                .ToDictionary(g => g.Key, g => g.Select(d => d.MMSI).Distinct().Count());

            var maxBucket = buckets.Keys.Max();
            var result = new List<AggregatedPeriod>();

            for (long i = 0; i <= maxBucket; i++)
            {
                var offsetSeconds = i * period.TotalSeconds;
                result.Add(new AggregatedPeriod
                {
                    PeriodLabel = FormatOffset(offsetSeconds),
                    UniqueBoatCount = buckets.TryGetValue(i, out var count) ? count : 0,
                    OffsetSeconds = offsetSeconds,
                    PeriodTime = reference.AddSeconds(offsetSeconds)
                });
            }

            return result;
        }

        public static AISStats CalculateStats(List<AISDetection> detections)
        {
            if (detections == null || detections.Count == 0)
                return new AISStats();

            var start = detections.Min(d => d.Timestamp);
            var end = detections.Max(d => d.Timestamp);

            return new AISStats
            {
                TotalUniqueBoats = detections.Select(d => d.MMSI).Distinct().Count(),
                RecordingStart = start,
                RecordingEnd = end,
                TotalDuration = end - start
            };
        }

        private static string FormatOffset(double seconds)
        {
            var hours = (int)(seconds / 3600);
            var minutes = (int)((seconds % 3600) / 60);
            var secs = (int)(seconds % 60);

            return hours > 0
                ? string.Format("{0}h {1:D2}:{2:D2}", hours, minutes, secs)
                : string.Format("{0:D2}:{1:D2}", minutes, secs);
        }
    }
}
