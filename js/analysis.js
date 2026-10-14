// Module d'analyse des données AIS
// Compatible avec le format : {"t": timestamp, "data": {"MetaData": {"time_utc": "..."}}}

(function() {
    'use strict';

    // Variables globales du module
    let analysisData = [];
    let analysisChart = null;
    let currentAggregation = 'hour';
    let currentChartType = 'bar';
    let startTime = null;  // Date de début pour calculer l'offset

    // Éléments DOM
    const modal = document.getElementById('analysis-modal');
    const btnAnalysis = document.getElementById('btn-analysis');
    const btnClose = document.getElementById('btn-analysis-modal-close');
    const tabButtons = document.querySelectorAll('.analysis-tab-button');
    const tabContents = document.querySelectorAll('.analysis-tab-content');

    // Éléments de chargement
    const jsonFileInput = document.getElementById('analysis-jsonFile');
    const fileNameSpan = document.getElementById('analysis-fileName');
    const fileInfoSection = document.getElementById('analysis-fileInfo');
    const loadedFileName = document.getElementById('analysis-loadedFileName');
    const fileSize = document.getElementById('analysis-fileSize');
    const detectionCount = document.getElementById('analysis-detectionCount');
    const timeRange = document.getElementById('analysis-timeRange');
    const processBtn = document.getElementById('btn-analysis-process');

    // Éléments de visualisation
    const chartCanvas = document.getElementById('analysis-chart');
    const aggregationSelect = document.getElementById('analysis-aggregation');
    const chartTypeSelect = document.getElementById('analysis-chartType');
    const updateBtn = document.getElementById('btn-analysis-update');
    const hoverInfo = document.getElementById('analysis-hoverInfo');

    // Éléments de stats
    const totalBoats = document.getElementById('analysis-totalBoats');
    const maxBoats = document.getElementById('analysis-maxBoats');
    const avgBoats = document.getElementById('analysis-avgBoats');
    const periodCovered = document.getElementById('analysis-periodCovered');

    // Initialisation
    function init() {
        if (!modal || !btnAnalysis) return;

        // Ouvrir la modal
        btnAnalysis.addEventListener('click', () => {
            modal.classList.remove('hidden');
            resetData();
        });

        // Fermer la modal
        btnClose.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        // Fermer en cliquant à l'extérieur
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });

        // Gestion des onglets
        initTabs();

        // Gestion du fichier
        initFileUpload();

        // Contrôles du graphique
        initChartControls();

        // Bouton de traitement
        processBtn.addEventListener('click', processFile);
    }

    // Gestion des onglets
    function initTabs() {
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.dataset.tab;
                
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                tabContents.forEach(content => {
                    if (content.id === tabId) {
                        content.classList.remove('hidden');
                    } else {
                        content.classList.add('hidden');
                    }
                });
            });
        });
    }

    // Gestion du fichier JSON
    function initFileUpload() {
        jsonFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            
            if (!file) return;
            
            fileNameSpan.textContent = file.name;
            loadedFileName.textContent = file.name;
            fileSize.textContent = formatFileSize(file.size);
            
            processBtn.disabled = false;
            
            resetData();
        });
    }

    // Formatage de la taille du fichier
    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' octets';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' Ko';
        return (bytes / (1024 * 1024)).toFixed(2) + ' Mo';
    }

    // Réinitialisation des données
    function resetData() {
        analysisData = [];
        detectionCount.textContent = '-';
        timeRange.textContent = '-';
        
        totalBoats.textContent = '-';
        maxBoats.textContent = '-';
        avgBoats.textContent = '-';
        periodCovered.textContent = '-';
        
        if (analysisChart) {
            analysisChart.destroy();
            analysisChart = null;
        }
        
        hoverInfo.textContent = 'Passez la souris sur le graphique pour voir les détails';
    }

    // Traitement du fichier JSON
    async function processFile() {
        const file = jsonFileInput.files[0];
        if (!file) return;
        
        try {
            const content = await readFile(file);
            analysisData = JSON.parse(content);
            
            if (!Array.isArray(analysisData)) {
                throw new Error('Le fichier JSON doit contenir un tableau de détections');
            }
            
            detectionCount.textContent = analysisData.length;
            
            // Extraire les timestamps et trouver le min
            let minTime = null;
            analysisData.forEach(d => {
                let timestamp = null;
                if (d.t !== undefined) {
                    timestamp = new Date(d.t);
                }
                else if (d.data && d.data.MetaData && d.data.MetaData.time_utc) {
                    timestamp = new Date(d.data.MetaData.time_utc);
                }
                else if (d.timestamp) timestamp = new Date(d.timestamp);
                else if (d.time) timestamp = new Date(d.time);
                else if (d.date) timestamp = new Date(d.date);
                else if (d.detectionTime) timestamp = new Date(d.detectionTime);
                
                if (timestamp && !isNaN(timestamp.getTime())) {
                    if (!minTime || timestamp.getTime() < minTime.getTime()) {
                        minTime = timestamp;
                    }
                }
            });
            
            if (!minTime) {
                throw new Error('Aucun timestamp valide trouvé dans les données');
            }
            
            // Stocker la date de début pour l'offset
            startTime = minTime;
            
            // Trouver maxTime pour la plage
            let maxTime = minTime;
            analysisData.forEach(d => {
                let timestamp = null;
                if (d.t !== undefined) {
                    timestamp = new Date(d.t);
                }
                else if (d.data && d.data.MetaData && d.data.MetaData.time_utc) {
                    timestamp = new Date(d.data.MetaData.time_utc);
                }
                else if (d.timestamp) timestamp = new Date(d.timestamp);
                else if (d.time) timestamp = new Date(d.time);
                else if (d.date) timestamp = new Date(d.date);
                else if (d.detectionTime) timestamp = new Date(d.detectionTime);
                
                if (timestamp && !isNaN(timestamp.getTime()) && timestamp.getTime() > maxTime.getTime()) {
                    maxTime = timestamp;
                }
            });
            
            timeRange.textContent = `${formatDate(minTime)} - ${formatDate(maxTime)}`;
            
            // Passer à l'onglet de visualisation
            document.querySelector('.analysis-tab-button[data-tab="analysis-visual"]').click();
            
            // Créer le graphique initial
            createChart('hour', 'bar');
            
        } catch (error) {
            alert(`Erreur: ${error.message}`);
            console.error('Erreur lors du traitement du fichier:', error);
        }
    }

    // Lecture du fichier
    function readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }

    // Formatage de la date
    function formatDate(date) {
        return date.toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Formater l'offset de temps (secondes -> HH:MM:SS ou MM:SS)
    function formatOffset(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}h ${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        } else {
            return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    }

    // Création du graphique
    function createChart(aggregation, chartType) {
        if (!analysisData || analysisData.length === 0) {
            alert('Aucune donnée disponible pour créer le graphique');
            return;
        }
        
        currentAggregation = aggregation;
        currentChartType = chartType;
        
        const aggregatedData = aggregateData(analysisData, aggregation);
        
        const labels = aggregatedData.map(item => item.offsetLabel || item.timeLabel);
        const counts = aggregatedData.map(item => item.count);
        
        updateStats(aggregatedData);
        
        const ctx = chartCanvas.getContext('2d');
        
        if (analysisChart) {
            analysisChart.destroy();
        }
        
        analysisChart = new Chart(ctx, {
            type: chartType,
            data: {
                labels: labels,
                datasets: [{
                    label: 'Nombre de bateaux uniques',
                    data: counts,
                    backgroundColor: 'rgba(102, 126, 234, 0.7)',
                    borderColor: 'rgba(102, 126, 234, 1)',
                    borderWidth: 2,
                    fill: chartType === 'line' ? true : false,
                    tension: chartType === 'line' ? 0.4 : 0,
                    pointRadius: chartType === 'line' ? 4 : 0,
                    pointHoverRadius: chartType === 'line' ? 6 : 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Nombre de bateaux'
                        },
                        ticks: {
                            stepSize: 1
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Temps écoulé'
                        },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Bateaux uniques: ${context.parsed.y}`;
                            },
                            afterLabel: function(context) {
                                const dataPoint = aggregatedData[context.dataIndex];
                                if (dataPoint) {
                                    const realTime = dataPoint.formattedTime ? `Heure: ${dataPoint.formattedTime}` : '';
                                    const offsetTime = dataPoint.offsetLabel ? `Offset: ${dataPoint.offsetLabel}` : '';
                                    return [realTime, offsetTime].filter(Boolean).join(' | ');
                                }
                                return null;
                            }
                        }
                    },
                    legend: {
                        position: 'top',
                    }
                },
                onClick: (e, activeEls) => {
                    if (activeEls.length > 0) {
                        const index = activeEls[0].index;
                        const dataPoint = aggregatedData[index];
                        showDetailedInfo(dataPoint);
                    }
                },
                animation: {
                    duration: 1000,
                    easing: 'easeInOutQuart'
                }
            }
        });
    }

    // Agrégation des données
    function aggregateData(data, aggregation) {
        const timeMap = new Map();
        
        // Trouver le timestamp minimum pour calculer les offsets
        let referenceTime = startTime;
        if (!referenceTime) {
            let minTime = null;
            data.forEach(detection => {
                let timestamp = extractTimestamp(detection);
                if (timestamp && !minTime) {
                    minTime = timestamp;
                } else if (timestamp && timestamp.getTime() < minTime.getTime()) {
                    minTime = timestamp;
                }
            });
            referenceTime = minTime;
        }
        
        if (!referenceTime) return [];
        
        data.forEach(detection => {
            let timestamp = extractTimestamp(detection);
            let mmsi = extractMMSI(detection);
            
            if (!timestamp || isNaN(timestamp.getTime())) return;
            if (!mmsi) return;
            
            const diffMs = timestamp.getTime() - referenceTime.getTime();
            const diffMinutes = diffMs / (1000 * 60);
            
            let key = '';
            let formattedTime = '';
            let timeLabel = '';
            let offsetSeconds = 0;
            
            switch (aggregation) {
                case '2min':
                    // Agrégation par buckets de 2 minutes depuis le début
                    const bucketIndex2 = Math.floor(diffMinutes / 2);
                    key = `bucket2_${bucketIndex2}`;
                    offsetSeconds = bucketIndex2 * 2 * 60;
                    formattedTime = formatOffset(offsetSeconds);
                    timeLabel = formattedTime;
                    break;
                    
                case '10min':
                    // Agrégation par buckets de 10 minutes depuis le début
                    const bucketIndex10 = Math.floor(diffMinutes / 10);
                    key = `bucket10_${bucketIndex10}`;
                    offsetSeconds = bucketIndex10 * 10 * 60;
                    formattedTime = formatOffset(offsetSeconds);
                    timeLabel = formattedTime;
                    break;
                    
                case '30min':
                    // Agrégation par buckets de 30 minutes depuis le début
                    const bucketIndex30 = Math.floor(diffMinutes / 30);
                    key = `bucket30_${bucketIndex30}`;
                    offsetSeconds = bucketIndex30 * 30 * 60;
                    formattedTime = formatOffset(offsetSeconds);
                    timeLabel = formattedTime;
                    break;
                    
                default: // hour
                    const bucketIndexHour = Math.floor(diffMinutes / 60);
                    key = `hour_${bucketIndexHour}`;
                    offsetSeconds = bucketIndexHour * 60 * 60;
                    formattedTime = formatOffset(offsetSeconds);
                    timeLabel = formattedTime;
            }
            
            if (!timeMap.has(key)) {
                timeMap.set(key, {
                    key: key,
                    mmsiSet: new Set(),
                    count: 0,
                    time: timestamp,
                    formattedTime: formattedTime,
                    timeLabel: timeLabel,
                    offsetSeconds: offsetSeconds
                });
            }
            
            const entry = timeMap.get(key);
            entry.mmsiSet.add(mmsi);
            entry.count = entry.mmsiSet.size;
        });
        
        const result = Array.from(timeMap.values());
        result.sort((a, b) => a.offsetSeconds - b.offsetSeconds);
        
        // Ajouter l'offsetLabel pour l'affichage
        result.forEach(entry => {
            entry.offsetLabel = formatOffset(entry.offsetSeconds);
        });
        
        return result;
    }

    // Extraire le timestamp d'une détection
    function extractTimestamp(detection) {
        if (detection.t !== undefined) {
            return new Date(detection.t);
        }
        if (detection.data && detection.data.MetaData && detection.data.MetaData.time_utc) {
            return new Date(detection.data.MetaData.time_utc);
        }
        if (detection.timestamp) return new Date(detection.timestamp);
        if (detection.time) return new Date(detection.time);
        if (detection.date) return new Date(detection.date);
        if (detection.detectionTime) return new Date(detection.detectionTime);
        return null;
    }

    // Extraire le MMSI d'une détection
    function extractMMSI(detection) {
        if (detection.data && detection.data.MetaData && detection.data.MetaData.MMSI) {
            return detection.data.MetaData.MMSI;
        }
        if (detection.MMSI) return detection.MMSI;
        return null;
    }

    // Mise à jour des statistiques
    function updateStats(aggregatedData) {
        const counts = aggregatedData.map(item => item.count);
        const total = counts.reduce((sum, count) => sum + count, 0);
        const max = Math.max(...counts);
        const avg = total / counts.length;
        
        totalBoats.textContent = total.toLocaleString('fr-FR');
        maxBoats.textContent = max.toLocaleString('fr-FR');
        avgBoats.textContent = avg.toFixed(1).replace('.', ',');
        
        if (aggregatedData.length > 0) {
            const first = aggregatedData[0].time;
            const last = aggregatedData[aggregatedData.length - 1].time;
            const durationHours = (last.getTime() - first.getTime()) / (1000 * 60 * 60);
            
            periodCovered.textContent = `${formatDate(first)} → ${formatDate(last)} (${durationHours.toFixed(1)}h)`;
        }
    }

    // Affichage des informations détaillées
    function showDetailedInfo(dataPoint) {
        hoverInfo.textContent = `Période : ${dataPoint.formattedTime} | Bateaux : ${dataPoint.count}`;
    }

    // Initialisation des contrôles du graphique
    function initChartControls() {
        aggregationSelect.addEventListener('change', () => {
            createChart(aggregationSelect.value, currentChartType);
        });
        
        chartTypeSelect.addEventListener('change', () => {
            createChart(currentAggregation, chartTypeSelect.value);
        });
        
        updateBtn.addEventListener('click', () => {
            createChart(aggregationSelect.value, chartTypeSelect.value);
        });
    }

    // Initialisation au chargement de la page
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
