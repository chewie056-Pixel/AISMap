// Utilitaires partagés pour la lecture des messages WebSocket AISStream.io

// AISStream envoie parfois les frames en binaire : evt.data peut être une
// chaîne, un Blob ou un ArrayBuffer selon le navigateur/serveur. Décode dans
// tous les cas puis appelle onMessage(data) avec l'objet JSON parsé.
function readAisMessage(evt, onMessage) {
  const parseAndDispatch = (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn("AIS: message non-JSON ignoré", raw, e);
      return;
    }
    onMessage(data);
  };

  if (typeof evt.data === "string") {
    parseAndDispatch(evt.data);
  } else if (evt.data instanceof Blob) {
    evt.data.text().then(parseAndDispatch);
  } else if (evt.data instanceof ArrayBuffer) {
    parseAndDispatch(new TextDecoder("utf-8").decode(evt.data));
  }
}
