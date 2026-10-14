// Variables globales
let boatData = [];
let chart = null;
let currentAggregation = 'hour';
let currentChartType = 'bar';

// DOM elements
const jsonFileInput = document.getElementById('jsonFile');
const fileNameSpan = document.getElementById('fileName');
const fileInfoSection = document.getElementById('fileInfo');
const loadedFileName = document.getElementById('loadedFileName');
const fileSize = document.getElementById('fileSize');
const detectionCount = document.getElementById('detectionCount');
const timeRange = document.getElementById('timeRange');
const processBtn = document.getElementById('processBtn');
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');
const boatChartCanvas = document.getElementById('boatChart');
const timeAggregationSelect = document.getElementById('timeAggregation');
const chartTypeSelect = document.getElementById('chartType');
const updateChartBtn = document.getElementById('updateChartBtn');
const hoverInfo = document.getElementById('hoverInfo');

// Stats elements
const totalBoats = document.getElementById('totalBoats');
const maxBoats = document.getElementById('maxBoats');
const avgBoats = document.getElementById('avgBoats');
const periodCovered = document.getElementById('periodCovered');

// Gestion des onglets
function initTabs() {
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.tab;
            
            // Mettre à jour les boutons actifs
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Afficher le contenu de l'onglet
            tabContents.forEach(content => {
                if (content.id === tabId) {
                    content.style.display = 'block';
                } else {
                    content.style.display = 'none';
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
        
        // Afficher le nom du fichier
        fileNameSpan.textContent = file.name;
        loadedFileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);
        
        // Activer le bouton de traitement
        processBtn.disabled = false;
        
        // Réinitialiser les données précédentes
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
    boatData = [];
    detectionCount.textContent = '-';
    timeRange.textContent = '-';
    
    // Réinitialiser les stats
    totalBoats.textContent = '-';
    maxBoats.textContent = '-';
    avgBoats.textContent = '-';
    periodCovered.textContent = '-';
    
    // Réinitialiser le graphique
    if (chart) {
        chart.destroy();
        chart = null;
    }
    
    hoverInfo.innerHTML = '<p>Passez la souris sur le graphique pour voir les détails</p>';
}

// Traitement du fichier JSON
async function processFile() {
    const file = jsonFileInput.files[0];
    if (!file) return;
    
    try {
        const content = await readFile(file);
        boatData = JSON.parse(content);
        
        // Valider et traiter les données
        if (!Array.isArray(boatData)) {
            throw new Error('Le fichier JSON doit contenir un tableau de détections');
        }
        
        // Afficher les informations du fichier
        detectionCount.textContent = boatData.length;
        
        // Extraire les timestamps - Support de plusieurs formats
        const timestamps = boatData.map(d => {
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
        
        // Trouver la plage de temps
        const minTime = new Date(Math.min(...timestamps.map(t => t.getTime())));
        const maxTime = new Date(Math.max(...timestamps.map(t => t.getTime())));
        
        timeRange.textContent = `${formatDate(minTime)} - ${formatDate(maxTime)}`;
        
        // Afficher un message de succès
        showNotification('Fichier traité avec succès !', 'success');
        
        // Passer à l'onglet de visualisation
        document.querySelector('.tab-button[data-tab="visualization"]').click();
        
        // Créer le graphique initial
        createChart('hour', 'bar');
        
    } catch (error) {
        showNotification(`Erreur: ${error.message}`, 'error');
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
    if (!boatData || boatData.length === 0) {
        showNotification('Aucune donnée disponible pour créer le graphique', 'error');
        return;
    }
    
    currentAggregation = aggregation;
    currentChartType = chartType;
    
    // Agrégation des données par période de temps
    const aggregatedData = aggregateData(boatData, aggregation);
    
    // Préparer les données pour le graphique
    const labels = aggregatedData.map(item => item.timeLabel);
    const counts = aggregatedData.map(item => item.count);
    
    // Mettre à jour les stats
    updateStats(aggregatedData);
    
    // Créer ou mettre à jour le graphique
    const ctx = boatChartCanvas.getContext('2d');
    
    if (chart) {
        chart.destroy();
    }
    
    chart = new Chart(ctx, {
        type: chartType,
        data: {
            labels: labels,
            datasets: [{
                label: 'Nombre de bateaux détectés',
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
                        text: aggregation === 'hour' ? 'Heure' : 
                             aggregation === 'minute' ? 'Minute' : 'Jour'
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
                            return `Nombre de bateaux: ${context.parsed.y}`;
                        },
                        afterLabel: function(context) {
                            const dataPoint = aggregatedData[context.dataIndex];
                            if (dataPoint && dataPoint.formattedTime) {
                                return `Heure: ${dataPoint.formattedTime}`;
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
    
    data.forEach(detection => {
        // Extraire le timestamp - Support de plusieurs formats
        let timestamp = null;
        
        // Format 1: timestamp Unix en millisecondes (champ 't')
        if (detection.t !== undefined) {
            timestamp = new Date(detection.t);
        }
        // Format 2: time_utc dans data.MetaData
        else if (detection.data && detection.data.MetaData && detection.data.MetaData.time_utc) {
            timestamp = new Date(detection.data.MetaData.time_utc);
        }
        // Format 3: timestamp standard
        else if (detection.timestamp) timestamp = new Date(detection.timestamp);
        else if (detection.time) timestamp = new Date(detection.time);
        else if (detection.date) timestamp = new Date(detection.date);
        else if (detection.detectionTime) timestamp = new Date(detection.detectionTime);
        
        if (!timestamp || isNaN(timestamp.getTime())) return;
        
        // Agrégation par heure, minute ou jour
        let key = '';
        let formattedTime = '';
        let timeLabel = '';
        
        switch (aggregation) {
            case 'minute':
                key = timestamp.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
                formattedTime = timestamp.toLocaleString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                timeLabel = formattedTime;
                break;
                
            case 'day':
                key = timestamp.toISOString().slice(0, 10); // YYYY-MM-DD
                formattedTime = timestamp.toLocaleString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });
                timeLabel = formattedTime;
                break;
                
            default: // hour
                key = timestamp.toISOString().slice(0, 13); // YYYY-MM-DDTHH
                formattedTime = timestamp.toLocaleString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
                timeLabel = formattedTime;
        }
        
        if (!timeMap.has(key)) {
            timeMap.set(key, {
                key: key,
                count: 0,
                time: timestamp,
                formattedTime: formattedTime,
                timeLabel: timeLabel
            });
        }
        
        const entry = timeMap.get(key);
        entry.count++;
    });
    
    // Convertir en tableau et trier par temps
    const result = Array.from(timeMap.values());
    result.sort((a, b) => a.time.getTime() - b.time.getTime());
    
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
    
    // Période couverte
    if (aggregatedData.length > 0) {
        const first = aggregatedData[0].time;
        const last = aggregatedData[aggregatedData.length - 1].time;
        const durationHours = (last.getTime() - first.getTime()) / (1000 * 60 * 60);
        
        periodCovered.textContent = `${formatDate(first)} → ${formatDate(last)} (${durationHours.toFixed(1)}h)`;
    }
}

// Affichage des informations détaillées
function showDetailedInfo(dataPoint) {
    hoverInfo.innerHTML = `
        <p><strong>Période :</strong> ${dataPoint.formattedTime}</p>
        <p><strong>Nombre de bateaux :</strong> ${dataPoint.count}</p>
    `;
}

// Notification
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.position = 'fixed';
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.padding = '15px 25px';
    notification.style.borderRadius = '8px';
    notification.style.background = type === 'success' ? '#4caf50' : '#f44336';
    notification.style.color = 'white';
    notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    notification.style.zIndex = '1000';
    notification.style.animation = 'fadeIn 0.3s ease';
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Initialisation des contrôles du graphique
function initChartControls() {
    timeAggregationSelect.addEventListener('change', () => {
        createChart(timeAggregationSelect.value, currentChartType);
    });
    
    chartTypeSelect.addEventListener('change', () => {
        createChart(currentAggregation, chartTypeSelect.value);
    });
    
    updateChartBtn.addEventListener('click', () => {
        createChart(timeAggregationSelect.value, chartTypeSelect.value);
    });
}

// Initialisation
function init() {
    initTabs();
    initFileUpload();
    initChartControls();
    
    // Bouton de traitement
    processBtn.addEventListener('click', processFile);
    
    // Gestion du glisser-déposer
    initDragAndDrop();
}

// Glisser-déposer
function initDragAndDrop() {
    const uploadSection = document.querySelector('.upload-section');
    
    uploadSection.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadSection.style.border = '2px dashed #667eea';
        uploadSection.style.backgroundColor = '#f0f4ff';
    });
    
    uploadSection.addEventListener('dragleave', () => {
        uploadSection.style.border = '';
        uploadSection.style.backgroundColor = '';
    });
    
    uploadSection.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadSection.style.border = '';
        uploadSection.style.backgroundColor = '';
        
        if (e.dataTransfer.files.length > 0) {
            jsonFileInput.files = e.dataTransfer.files;
            jsonFileInput.dispatchEvent(new Event('change'));
        }
    });
}

// Démarrage de l'application
document.addEventListener('DOMContentLoaded', init);
