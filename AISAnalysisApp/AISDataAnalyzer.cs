using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

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
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            using var doc = JsonDocument.Parse(File.ReadAllText(filePath));

            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                throw new InvalidDataException("Le fichier JSON doit contenir un tableau de d\u00e9tections");

            var detections = new List<AISDetection>();

            foreach (var element in doc.RootElement.EnumerateArray())
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

        private static DateTime? ExtractTimestamp(JsonElement element)
        {
            // Format principal : { "t": ... }
            if (element.TryGetProperty("t", out var t))
            {
                if (TryParseDate(t, out var date)) return date;
            }

            // Format AISMap : { "data": { "MetaData": { "time_utc": ... } } }
            if (element.TryGetProperty("data", out var data) &&
                data.ValueKind == JsonValueKind.Object &&
                data.TryGetProperty("MetaData", out var meta) &&
                meta.ValueKind == JsonValueKind.Object &&
                meta.TryGetProperty("time_utc", out var timeUtc) &&
                TryParseDate(timeUtc, out var metaDate))
            {
                return metaDate;
            }

            // Formats alternatifs
            string[] altKeys = { "timestamp", "time", "date", "detectionTime" };
            foreach (var key in altKeys)
            {
                if (element.TryGetProperty(key, out var prop) && TryParseDate(prop, out var d))
                    return d;
            }

            return null;
        }

        private static string ExtractMMSI(JsonElement element)
        {
            if (element.TryGetProperty("data", out var data) &&
                data.ValueKind == JsonValueKind.Object &&
                data.TryGetProperty("MetaData", out var meta) &&
                meta.ValueKind == JsonValueKind.Object &&
                meta.TryGetProperty("MMSI", out var mmsiProp))
            {
                return mmsiProp.ValueKind == JsonValueKind.Number
                    ? mmsiProp.GetRawText()
                    : mmsiProp.GetString();
            }

            if (element.TryGetProperty("MMSI", out var direct))
            {
                return direct.ValueKind == JsonValueKind.Number
                    ? direct.GetRawText()
                    : direct.GetString();
            }

            return null;
        }

        private static bool TryParseDate(JsonElement element, out DateTime date)
        {
            date = default;
            try
            {
                string raw = element.ValueKind == JsonValueKind.Number
                    ? DateTimeOffset.FromUnixTimeMilliseconds(element.GetInt64()).DateTime.ToString("o")
                    : element.GetString();

                if (string.IsNullOrEmpty(raw)) return false;

                if (DateTime.TryParse(raw, null, System.Globalization.DateTimeStyles.RoundtripKind, out date))
                    return true;

                return DateTime.TryParse(raw, out date);
            }
            catch
            {
                return false;
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
                ? $"{hours}h {minutes:D2}:{secs:D2}"
                : $"{minutes:D2}:{secs:D2}";
        }
    }
}
