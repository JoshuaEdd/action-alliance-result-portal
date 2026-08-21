// Minimal IndexedDB queue for submissions made without connectivity.
// Files are stored as Blobs (structured-clonable) so a dropped signal
// doesn't lose captured photos — only the final HTTP POST is deferred.
//
// A second store, 'capture-log', is an append-only audit trail of every
// photo capture (slot + exact wall-clock time + GPS fix quality). It is
// written at shutter press even with zero connectivity, so "when was this
// actually taken?" always has a durable answer on the device.

const DB_NAME = 'election-portal';
const DB_VERSION = 2;
const STORE = 'pending-submissions';
const LOG_STORE = 'capture-log';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'localId' });
      }
      if (!db.objectStoreNames.contains(LOG_STORE)) {
        db.createObjectStore(LOG_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Append one capture event. Fire-and-forget friendly: never throws to the
// caller — a logging failure must not interrupt the capture flow.
export async function logCapture({ slot, capturedAt, lat, lng, accuracy }) {
  try {
    const db = await openDb();
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      slot,
      capturedAt,
      lat,
      lng,
      accuracy,
      loggedAt: new Date().toISOString(),
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE, 'readwrite');
      tx.objectStore(LOG_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Swallow — capture log is best-effort; the submission itself carries
    // the authoritative per-photo timestamps.
  }
}

export async function enqueueSubmission({ fields, files }) {
  const db = await openDb();
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const record = { localId, fields, files, createdAt: Date.now(), attempts: 0 };
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return localId;
}

export async function listPending() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function removeFromQueue(localId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(localId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Attempts to flush every queued submission. Called on 'online' events
// and on a periodic timer from SubmissionContext.
export async function flushQueue({ token, submitFn, onResult }) {
  if (!navigator.onLine) return;
  const pending = await listPending();
  for (const record of pending) {
    try {
      const formData = new FormData();
      Object.entries(record.fields).forEach(([k, v]) => formData.append(k, v));
      Object.entries(record.files).forEach(([k, blob]) => formData.append(k, blob, `${k}.jpg`));

      const result = await submitFn(token, formData);
      await removeFromQueue(record.localId);
      onResult?.({ localId: record.localId, status: 'uploaded', result });
    } catch (err) {
      // Leave it queued and retry on the next flush pass
      onResult?.({ localId: record.localId, status: 'retry-failed', error: err.message });
    }
  }
}
