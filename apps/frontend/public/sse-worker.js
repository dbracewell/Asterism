const ports = new Set();
/** When each tab last said it is alive (US-117.2). */
const lastSeen = new Map();
let eventSource = null;
let reconnectTimer = null;
let sweepTimer = null;
// After a sign-out only a newly loaded page reopens the stream.
let signedOut = false;

const RECONNECT_DELAY_MS = 2000;
// Tabs send "alive" every 15 seconds. A tab that closed without saying so (a
// crash, a mobile browser dropping the page) is dropped after 3 minutes, long
// enough for a background tab whose timers the browser slows to once a minute.
const SWEEP_INTERVAL_MS = 15000;
const TAB_TIMEOUT_MS = 180000;

function initSSE() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  // No tab is listening: stay closed until one connects again.
  if (eventSource || ports.size === 0) return;

  // Relative or absolute stream endpoint
  eventSource = new EventSource("/api/stream");

  eventSource.onmessage = (event) => {
    broadcast({ type: "message", data: event.data });
  };

  eventSource.onerror = () => {
    broadcast({ type: "error", data: "SSE error" });
    if (!eventSource) return;
    eventSource.close();
    eventSource = null;
    if (ports.size > 0) {
      reconnectTimer = setTimeout(initSSE, RECONNECT_DELAY_MS);
    }
  };
}

function closeStream() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearInterval(sweepTimer);
  sweepTimer = null;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

/** Closes the stream and cancels any pending reconnect once no tab is left. */
function closeIfIdle() {
  if (ports.size > 0) return;
  closeStream();
}

function removePort(port) {
  ports.delete(port);
  lastSeen.delete(port);
  closeIfIdle();
}

function sweep() {
  const now = Date.now();
  for (const [port, seen] of lastSeen) {
    if (now - seen > TAB_TIMEOUT_MS) removePort(port);
  }
}

/** Sign-out: the stream belonged to that session, so it and every tab's port go. */
function signOut() {
  signedOut = true;
  ports.clear();
  lastSeen.clear();
  closeStream();
}

function broadcast(payload) {
  ports.forEach((port) => {
    try {
      port.postMessage(payload);
    } catch {
      removePort(port);
    }
  });
}

function addPort(port) {
  ports.add(port);
  lastSeen.set(port, Date.now());
  sweepTimer ??= setInterval(sweep, SWEEP_INTERVAL_MS);
  initSSE();
}

self.onconnect = (event) => {
  const port = event.ports[0];
  signedOut = false;
  port.start();

  port.onmessage = (e) => {
    if (e.data === "unload") removePort(port);
    else if (e.data === "signout") signOut();
    else if (e.data === "alive") {
      if (ports.has(port)) lastSeen.set(port, Date.now());
      // A tab dropped while its timers were slowed comes back.
      else if (!signedOut) addPort(port);
    }
  };

  addPort(port);
};
