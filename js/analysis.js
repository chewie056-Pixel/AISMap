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
            
            // Extraire les timestamps
            const timestamps = analysisData.map(d => {
                // Format 1: timestamp Unix en millisecondes (champ 't')
                if (d.t !== undefined) {
                    return new Date(d.t);
                }
                // Format 2: time_utc dans data.MetaData
                if (d.data && d.data.MetaData && d.data.MetaData.time_utc) {
                    return new Date(d.data.MetaData.time_utc);
                }
                // Format 3: timestamp standard
                if (d.timestamp) return new Date(d.timestamp);
                if (d.time) return new Date(d.time);
                if (d.date) return new Date(d.date);
                if (d.detectionTime) return new Date(d.detectionTime);
                return null;
            }).filter(Boolean);
            
            if (timestamps.length === 0) {
                throw new Error('Aucun timestamp valide trouvé dans les données');
            }
            
            const minTime = new Date(Math.min(...timestamps.map(t => t.getTime())));
            const maxTime = new Date(Math.max(...timestamps.map(t => t.getTime())));
            
            // Stocker la date de début pour l'offset
            startTime = minTime;
            
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
        let tempStartTime = null;
        data.forEach(detection => {
            let timestamp = null;
            let mmsi = null;
            
            // Extraire le timestamp et le MMSI
            if (detection.t !== undefined) {
                timestamp = new Date(detection.t);
                if (detection.data && detection.data.MetaData && detection.data.MetaData.MMSI) {
                    mmsi = detection.data.MetaData.MMSI;
                }
            }
            else if (detection.data && detection.data.MetaData && detection.data.MetaData.time_utc) {
                timestamp = new Date(detection.data.MetaData.time_utc);
                if (detection.data.MetaData.MMSI) {
                    mmsi = detection.data.MetaData.MMSI;
                }
            }
            else if (detection.timestamp) {
                timestamp = new Date(detection.timestamp);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            else if (detection.time) {
                timestamp = new Date(detection.time);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            else if (detection.date) {
                timestamp = new Date(detection.date);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            else if (detection.detectionTime) {
                timestamp = new Date(detection.detectionTime);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            
            if (!timestamp || isNaN(timestamp.getTime())) return;
            if (!mmsi) return;
            
            // Trouver la date de début si ce n'est pas encore fait
            if (!tempStartTime || timestamp.getTime() < tempStartTime.getTime()) {
                tempStartTime = new Date(timestamp.getTime());
            }
        });
        
        // Utiliser startTime global si disponible, sinon tempStartTime
        const referenceTime = startTime || tempStartTime;
        if (!referenceTime) return [];
        
        data.forEach(detection => {
            let timestamp = null;
            let mmsi = null;
            
            // Extraire à nouveau (on pourrait optimiser mais c'est plus clair)
            if (detection.t !== undefined) {
                timestamp = new Date(detection.t);
                if (detection.data && detection.data.MetaData && detection.data.MetaData.MMSI) {
                    mmsi = detection.data.MetaData.MMSI;
                }
            }
            else if (detection.data && detection.data.MetaData && detection.data.MetaData.time_utc) {
                timestamp = new Date(detection.data.MetaData.time_utc);
                if (detection.data.MetaData.MMSI) {
                    mmsi = detection.data.MetaData.MMSI;
                }
            }
            else if (detection.timestamp) {
                timestamp = new Date(detection.timestamp);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            else if (detection.time) {
                timestamp = new Date(detection.time);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            else if (detection.date) {
                timestamp = new Date(detection.date);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            else if (detection.detectionTime) {
                timestamp = new Date(detection.detectionTime);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            
            if (!timestamp || isNaN(timestamp.getTime())) return;
            if (!mmsi) return;
            
            let key = '';
            let formattedTime = '';
            let timeLabel = '';
            let offsetSeconds = 0;
            
            const diffMs = timestamp.getTime() - referenceTime.getTime();
            const diffMinutes = diffMs / (1000 * 60);
            
            switch (aggregation) {
                case '10min':
                    // Agrégation par buckets de 10 minutes depuis le début
                    const bucketIndex = Math.floor(diffMinutes / 10);
                    key = `bucket_${bucketIndex}`;
                    
                    // Temps du début du bucket
                    const bucketStartMinutes = bucketIndex * 10;
                    offsetSeconds = bucketStartMinutes * 60;
                    
                    formattedTime = formatOffset(offsetSeconds);
                    timeLabel = formattedTime;
                    break;
                    
                case 'day':
                    key = timestamp.toISOString().slice(0, 10);
                    formattedTime = timestamp.toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });
                    timeLabel = formattedTime;
                    offsetSeconds = diffMs / 1000;
                    break;
                    
                default: // hour
                    key = timestamp.toISOString().slice(0, 13);
                    formattedTime = timestamp.toLocaleString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    timeLabel = formattedTime;
                    offsetSeconds = diffMs / 1000;
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
            // Format 2: time_utc dans data.MetaData
            else if (detection.data && detection.data.MetaData && detection.data.MetaData.time_utc) {
                timestamp = new Date(detection.data.MetaData.time_utc);
                if (detection.data.MetaData.MMSI) {
                    mmsi = detection.data.MetaData.MMSI;
                }
            }
            // Format 3: timestamp standard
            else if (detection.timestamp) {
                timestamp = new Date(detection.timestamp);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            else if (detection.time) {
                timestamp = new Date(detection.time);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            else if (detection.date) {
                timestamp = new Date(detection.date);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            else if (detection.detectionTime) {
                timestamp = new Date(detection.detectionTime);
                if (detection.MMSI) mmsi = detection.MMSI;
            }
            
            if (!timestamp || isNaN(timestamp.getTime())) return;
            if (!mmsi) return; // On ne compte que les détections avec MMSI
            
            let key = '';
            let formattedTime = '';
            let timeLabel = '';
            
            switch (aggregation) {
                case '10min':
                    // Agrégation par 10 minutes basée sur l'offset
                    if (startTime) {
                        const diffMs = timestamp.getTime() - startTime.getTime();
                        const diffMinutes = Math.floor(diffMs / (1000 * 60));
                        const bucketIndex = Math.floor(diffMinutes / 10);
                        
                        // Créer une clé de bucket unique
                        key = `10min_${bucketIndex}`;
                        
                        // Calculer le temps de début du bucket
                        const bucketStartMinutes = bucketIndex * 10;
                        const bucketStartMs = bucketStartMinutes * 60 * 1000;
                        const bucketStartDate = new Date(startTime.getTime() + bucketStartMs);
                        
                        formattedTime = bucketStartDate.toLocaleString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        timeLabel = formattedTime;
                    } else {
                        // Fallback si startTime n'est pas défini
                        const minutes = timestamp.getMinutes();
                        const roundedMinutes = Math.floor(minutes / 10) * 10;
                        const roundedDate = new Date(timestamp);
                        roundedDate.setMinutes(roundedMinutes, 0, 0);
                        
                        key = roundedDate.toISOString().slice(0, 16);
                        formattedTime = roundedDate.toLocaleString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit'
                        });
                        timeLabel = formattedTime;
                    }
                    break;
                    
                case 'day':
                    key = timestamp.toISOString().slice(0, 10);
                    formattedTime = timestamp.toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });
                    timeLabel = formattedTime;
                    break;
                    
                default: // hour
                    key = timestamp.toISOString().slice(0, 13);
                    formattedTime = timestamp.toLocaleString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit'
                    });
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
                    offsetSeconds: 0  // sera calculé plus tard
                });
            }
            
            const entry = timeMap.get(key);
            // Ajouter le MMSI au Set (automatiquement dédupliqué)
            entry.mmsiSet.add(mmsi);
            // Mettre à jour le count avec la taille du Set
            entry.count = entry.mmsiSet.size;
        });
        
        const result = Array.from(timeMap.values());
        result.sort((a, b) => a.time.getTime() - b.time.getTime());
        
        // Calculer l'offset pour chaque entrée
        if (startTime) {
            result.forEach(entry => {
                // Pour 10min, utiliser le bucket index pour calculer l'offset
                if (entry.key && entry.key.startsWith('10min_')) {
                    const bucketIndex = parseInt(entry.key.replace('10min_', ''));
                    const bucketStartMinutes = bucketIndex * 10;
                    const totalSeconds = bucketStartMinutes * 60;
                    entry.offsetSeconds = totalSeconds;
                    entry.offsetLabel = formatOffset(totalSeconds);
                } else {
                    const diffMs = entry.time.getTime() - startTime.getTime();
                    entry.offsetSeconds = diffMs / 1000;
                    entry.offsetLabel = formatOffset(entry.offsetSeconds);
                }
            });
        }
        
        return result;
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
        hoverInfo.textContent = `Période : ${dataPoint.formattedTime} | Nombre de bateaux : ${dataPoint.count}`;
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

    // Initialisation au chargement de la page
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
