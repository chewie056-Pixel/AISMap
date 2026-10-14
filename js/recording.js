// Page "Enregistrement" — pilote l'enregistrement (CSV/JSON) et le rejeu
// (x1 à x20) gérés par le serveur local. Se connecte au serveur comme les
// autres pages pour recevoir les mises à jour d'état en direct ; les actions
// (démarrer, arrêter, rejouer, supprimer) passent par l'API REST du serveur.

let serverWs = null;
let serverReconnectAttempts = 0;
let serverReconnectTimer = null;
let lastReplaySpeedInput = 1;
let recordingStartedAt = null;

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheDomRefs();
  wireUi();
  connectToServer();
  refreshRecordings();

  setInterval(() => {
    if (recordingStartedAt) {
      els.recordingDuration.textContent = formatDuration(Date.now() - recordingStartedAt);
    }
  }, 1000);
}

function cacheDomRefs() {
  els.status = document.getElementById("status");
  els.statusText = document.getElementById("status-text");

  els.noConfig = document.getElementById("recording-no-config");
  els.recordingSection = document.getElementById("recording-section");
  els.recordingsListSection = document.getElementById("recordings-list-section");
  els.replaySection = document.getElementById("replay-section");

  els.idleControls = document.getElementById("recording-idle-controls");
  els.activeControls = document.getElementById("recording-active-controls");
  els.btnRecordingStart = document.getElementById("btn-recording-start");
  els.btnRecordingStop = document.getElementById("btn-recording-stop");
  els.recordingFormatLabel = document.getElementById("recording-format-label");
  els.recordingDuration = document.getElementById("recording-duration");
  els.recordingMessageCount = document.getElementById("recording-message-count");

  els.recordingsTbody = document.getElementById("recordings-tbody");
  els.recordingsEmptyRow = document.getElementById("recordings-empty-row");

  els.replayCurrentLabel = document.getElementById("replay-current-label");
  els.replayCurrentProgress = document.getElementById("replay-current-progress");
  els.replaySpeedRange = document.getElementById("replay-speed-range");
  els.replaySpeedValue = document.getElementById("replay-speed-value");
  els.btnReplayPause = document.getElementById("btn-replay-pause");
  els.btnReplayResume = document.getElementById("btn-replay-resume");
  els.btnReplayStop = document.getElementById("btn-replay-stop-2");
}

function wireUi() {
  els.btnRecordingStart.addEventListener("click", startRecording);
  els.btnRecordingStop.addEventListener("click", stopRecording);
  els.btnReplayPause.addEventListener("click", () => postJson("/api/replay/pause"));
  els.btnReplayResume.addEventListener("click", () => postJson("/api/replay/resume"));
  els.btnReplayStop.addEventListener("click", () => postJson("/api/replay/stop"));

  els.replaySpeedRange.addEventListener("input", () => {
    lastReplaySpeedInput = Number(els.replaySpeedRange.value);
    els.replaySpeedValue.textContent = lastReplaySpeedInput;
  });
  els.replaySpeedRange.addEventListener("change", () => {
    postJson("/api/replay/speed", { speed: Number(els.replaySpeedRange.value) });
  });
}

function setStatus(state, text) {
  els.status.className = "status status-" + state;
  els.statusText.textContent = text;
}

// --- Connexion au serveur local ---

function connectToServer() {
  let socket;
  try {
    socket = new WebSocket(SERVER_WS_URL);
  } catch {
    setStatus("error", "Impossible de joindre le serveur local");
    scheduleServerReconnect();
    return;
  }
  serverWs = socket;

  socket.onopen = () => {
    serverReconnectAttempts = 0;
  };

  socket.onmessage = (evt) => readAisMessage(evt, handleServerMessage);

  socket.onerror = (evt) => {
    console.error("Serveur local : erreur WebSocket", evt);
  };

  socket.onclose = () => {
    serverWs = null;
    setStatus("error", "Connexion au serveur local perdue — nouvelle tentative…");
    scheduleServerReconnect();
  };
}

function scheduleServerReconnect() {
  serverReconnectAttempts++;
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * 2 ** (serverReconnectAttempts - 1),
    RECONNECT_MAX_DELAY_MS
  );
  clearTimeout(serverReconnectTimer);
  serverReconnectTimer = setTimeout(connectToServer, delay);
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case "status":
      setStatus(msg.state, msg.text);
      break;
    case "config":
      showConfigured(msg.configured);
      break;
    case "recording-status":
      renderRecordingStatus(msg);
      break;
    case "replay-status":
      renderReplayStatus(msg);
      break;
    default:
      break;
  }
}

function showConfigured(configured) {
  els.noConfig.classList.toggle("hidden", configured);
  els.recordingSection.classList.toggle("hidden", !configured);
  els.recordingsListSection.classList.toggle("hidden", !configured);
}

// --- Enregistrement ---

function renderRecordingStatus(status) {
  const recording = status.state === "recording";
  els.idleControls.classList.toggle("hidden", recording);
  els.activeControls.classList.toggle("hidden", !recording);

  if (recording) {
    recordingStartedAt = status.startedAt;
    els.recordingFormatLabel.textContent = status.format.toUpperCase();
    els.recordingMessageCount.textContent = status.messageCount;
    els.recordingDuration.textContent = formatDuration(Date.now() - status.startedAt);
  } else {
    recordingStartedAt = null;
    refreshRecordings();
  }
}

function startRecording() {
  const format = document.querySelector('input[name="format"]:checked').value;
  postJson("/api/recording/start", { format }).catch((e) => alert("Erreur : " + e.message));
}

function stopRecording() {
  postJson("/api/recording/stop")
    .then(refreshRecordings)
    .catch((e) => alert("Erreur : " + e.message));
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

// --- Liste des enregistrements ---

async function refreshRecordings() {
  const recordings = await fetch("/api/recordings").then((r) => r.json());
  renderRecordings(recordings);
}

function renderRecordings(recordings) {
  if (recordings.length === 0) {
    els.recordingsTbody.innerHTML = "";
    els.recordingsTbody.appendChild(els.recordingsEmptyRow);
    return;
  }

  els.recordingsTbody.innerHTML = recordings
    .map((r) => {
      const start = new Date(r.startedAt).toLocaleString("fr-FR");
      const sizeKb = (r.sizeBytes / 1024).toFixed(1);
      const statusLabel = r.complete
        ? '<span class="status-complete">Terminé</span>'
        : '<span class="status-incomplete">En cours</span>';
      const disabled = r.complete ? "" : "disabled";
      return `
        <tr>
          <td>${escapeHtml(start)}</td>
          <td>${r.format.toUpperCase()}</td>
          <td>${r.messageCount}</td>
          <td>${sizeKb} Ko</td>
          <td>${statusLabel}</td>
          <td class="actions-cell">
            <a class="table-action btn-primary-link" ${disabled ? "" : `href="/api/recordings/${r.id}/download"`} ${disabled}>Télécharger</a>
            <button class="table-action" data-action="replay" data-id="${r.id}" ${disabled}>▶ Rejouer</button>
            <button class="table-action btn-stop" data-action="delete" data-id="${r.id}" ${disabled}>Supprimer</button>
          </td>
        </tr>`;
    })
    .join("");

  els.recordingsTbody.querySelectorAll('[data-action="replay"]').forEach((btn) => {
    btn.addEventListener("click", () => startReplay(btn.dataset.id));
  });
  els.recordingsTbody.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", () => deleteRecording(btn.dataset.id));
  });
}

function startReplay(id) {
  postJson("/api/replay/start", { id, speed: lastReplaySpeedInput })
    .catch((e) => alert("Erreur : " + e.message));
}

function deleteRecording(id) {
  if (!confirm("Supprimer définitivement cet enregistrement ?")) return;
  fetch(`/api/recordings/${id}`, { method: "DELETE" })
    .then(refreshRecordings)
    .catch((e) => alert("Erreur : " + e.message));
}

// --- Rejeu ---

function renderReplayStatus(status) {
  const active = status.state !== "idle";
  els.replaySection.classList.toggle("hidden", !active);
  if (!active) return;

  els.replayCurrentLabel.textContent = status.recordingId || "";
  els.replayCurrentProgress.textContent = `${status.index} / ${status.total}`;
  els.replaySpeedRange.value = status.speed;
  els.replaySpeedValue.textContent = status.speed;
  lastReplaySpeedInput = status.speed;

  els.btnReplayPause.classList.toggle("hidden", status.state !== "playing");
  els.btnReplayResume.classList.toggle("hidden", status.state !== "paused");
}

// --- Utilitaire fetch ---

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur HTTP ${res.status}`);
  return data;
}
