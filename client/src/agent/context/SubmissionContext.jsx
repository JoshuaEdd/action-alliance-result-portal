import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../api/client';
import { enqueueSubmission, flushQueue } from '../../api/offlineQueue';
import { useAuth } from '../../context/AuthContext';
import { getLocation, formatLocationError } from '../utils/geo';
import { sanitizeVotesMap } from '../utils/results';

const SubmissionContext = createContext(null);
const DRAFT_KEY = 'result-draft-v1';

export const STEPS = ['location', 'votes', 'agent', 'photos', 'preview'];

// Every election-result figure defaults to 0 (req: result fields default to
// zero). Name/phone are filled from the agent's registration profile by the
// AgentDetailsStep — the agent is never asked for them again.
const emptyDraft = {
  totalRegisteredVoters: '0',
  totalAccreditedVoters: '0',
  totalInvalidVotes: '0',
  submittingAgentName: '',
  submittingAgentPhone: '',
};

const NUMERIC_DRAFT_KEYS = ['totalRegisteredVoters', 'totalAccreditedVoters', 'totalInvalidVotes'];

// A saved draft may predate the zero-defaults: any empty/blank or non-numeric
// numeric field is restored as '0' instead of carrying a stray ''.
function normalizeDraft(saved) {
  const base = { ...emptyDraft, ...saved };
  NUMERIC_DRAFT_KEYS.forEach((k) => {
    const raw = String(base[k] ?? '').trim();
    base[k] = /^[0-9]+$/.test(raw) ? raw.replace(/^0+(?=\d)/, '') : '0';
  });
  return base;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SubmissionProvider({ children }) {
  const { token, user } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      return saved ? normalizeDraft(JSON.parse(saved)) : emptyDraft;
    } catch {
      return emptyDraft;
    }
  });
  // Per-party vote counts: { [partyId]: '0' }. Kept separate from draft's
  // flat fields since it's keyed dynamically by party, still persisted the
  // same way (FR-2.11 local draft autosave).
  const [partyVotes, setPartyVotes] = useState(() => {
    try {
      const saved = localStorage.getItem(`${DRAFT_KEY}:parties`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  // Photo blobs are kept in memory only (FR-2.6/2.7) — large binary data isn't
  // suited to localStorage; a background sync worker would be the next step
  // if the app needs to survive a full process kill mid-capture.
  const [photos, setPhotos] = useState({}); // { agentTagPhoto, resultSheetPhoto, agentPassportPhoto }
  // data: URL of each captured photo, keyed like photos. This is the review
  // state for the capture step AND the Review-photos stage: a captured photo
  // must keep being previewable even if the agent navigates away and back
  // (the step div remounts on step changes, wiping local-only state).
  const [photoPreviews, setPhotoPreviews] = useState({});
  // Per-slot acceptance flag: { key: true } once the agent taps "Use Photo"
  // on the review of that shot.
  const [photoConfirmed, setPhotoConfirmed] = useState({});
  // Exact wall-clock ISO time of each shutter press, keyed like photos.
  // Travels with the submission so the server can store per-photo capture
  // times even when everything arrives hours later via the offline queue.
  const [photoMeta, setPhotoMeta] = useState({});
  const [gps, setGps] = useState(null); // { lat, lng, capturedAt, accuracy, placeName }
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState(null);
  // Geo acquisition status so the capture step can tell the agent exactly
  // what the phone is doing: idle → locating → retrying → error, then active
  // once a fix lands (uploads are blocked until then).
  const [gpsStatus, setGpsStatus] = useState('idle');
  const [submitResult, setSubmitResult] = useState(null); // { referenceNumber, status } | { queued: true }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Mirrors `gps` so the async retry loop can reason about it without stale
  // closures, and guards against two loops ever running concurrently.
  const gpsRef = useRef(gps);
  const retryLoopRef = useRef(false);
  const stopRequestedRef = useRef(false);
  useEffect(() => {
    gpsRef.current = gps;
  }, [gps]);

  const requestGps = useCallback(async () => {
    setGpsLoading(true);
    setGpsError(null);
    try {
      const pos = await getLocation();
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      const capturedAt = new Date().toISOString();
      const fix = {
        lat,
        lng,
        capturedAt,
        accuracy,
        street: null,
        placeName: null,
        approximatePlace: null,
        shortName: null,
      };
      setGps(fix);
      setGpsStatus('active');
      setGpsLoading(false);
      // Human-readable place name, resolved through the server (Nominatim is
      // unreliable straight from the browser): the chip and photo watermark
      // keep showing it once it lands, and never fall back to raw coordinates.
      api
        .reverseGeocodePlace(token, lat, lng)
        .then(({ place }) => {
          if (place) {
            setGps((g) =>
              g
                ? {
                    ...g,
                    street: place,
                    placeName: place,
                    approximatePlace: place,
                    shortName: place,
                  }
                : g
            );
          }
        })
        .catch(() => {});
      return fix;
    } catch (err) {
      setGpsLoading(false);
      const msg = formatLocationError(err);
      setGpsError(msg);
      throw err;
    }
  }, [token]);

  // Auto-retry geolocation until a fix is obtained (req: keep retrying,
  // never let the agent upload without a location). One guarded loop, wakes
  // every 5s (10s when permission is hard-blocked, to avoid a busy spin on
  // browsers that return a denial instantly) and only exits on a fix or an
  // explicit stop. The step UI surfaces the current gpsStatus text.
  const startAutoRetryGeolocation = useCallback(async () => {
    if (retryLoopRef.current) return;
    retryLoopRef.current = true;
    stopRequestedRef.current = false;
    try {
      while (!gpsRef.current && !stopRequestedRef.current) {
        setGpsStatus('locating');
        try {
          await requestGps();
          if (gpsRef.current) break;
        } catch (err) {
          const denied = err?.code === 1;
          setGpsStatus(denied ? 'error' : 'retrying');
          // Permission hard-blocked: slow the retry to 10s so a browser that
          // answers denial instantly doesn't busy-spin; everything else retries
          // every 5s until a fix lands.
          await sleep(denied ? 10000 : 5000);
        }
      }
    } finally {
      retryLoopRef.current = false;
    }
  }, [requestGps]);

  const stopAutoRetryGeolocation = useCallback(() => {
    stopRequestedRef.current = true;
  }, []);

  // Proactively check if geolocation permission is already granted.
  // If granted (e.g. returning agent or previously allowed in browser),
  // obtain the fix early so that Steps 1-3 show active GPS and Step 4 unlocks immediately.
  // If not granted ('prompt'), we don't pop up prematurely to respect mobile browser UX.
  useEffect(() => {
    if (typeof window !== 'undefined' && navigator?.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (status.state === 'granted') {
            requestGps().catch(() => {});
          }
        })
        .catch(() => {});
    }
  }, [requestGps]);

  // FR-2.11 — auto-save local draft as the agent progresses
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    localStorage.setItem(`${DRAFT_KEY}:parties`, JSON.stringify(partyVotes));
  }, [partyVotes]);

  const updatePartyVotes = useCallback((patch) => setPartyVotes((p) => ({ ...p, ...patch })), []);
  const seedPartyVotes = useCallback(
    (partyIds) => {
      setPartyVotes((p) => {
        const missing = partyIds.filter((id) => p[id] === undefined || p[id] === '');
        return missing.length ? { ...p, ...Object.fromEntries(missing.map((id) => [id, '0'])) } : p;
      });
    },
    []
  );

  const updateDraft = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), []);

  const goNext = useCallback(() => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1)), []);
  const goBack = useCallback(() => setStepIndex((i) => Math.max(i - 1, 0)), []);

  const clearDraft = useCallback(() => {
    setDraft(emptyDraft);
    setPartyVotes({});
    setPhotos({});
    setPhotoPreviews({});
    setPhotoConfirmed({});
    setPhotoMeta({});
    setGps(null);
    setGpsError(null);
    setGpsStatus('idle');
    setStepIndex(0);
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(`${DRAFT_KEY}:parties`);
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);

    // Uploads are blocked entirely without a geolocation fix (req) — this is
    // the last line of defence on the client; the server rejects too.
    if (!gps) {
      setSubmitting(false);
      setSubmitError('Location is required before the result can be sent. Please allow location access.');
      return;
    }

    // Digits-only guarantee before the payload leaves the browser.
    const { clean, dropped } = sanitizeVotesMap(partyVotes);
    if (dropped > 0) {
      setSubmitting(false);
      setSubmitError('Some party vote entries contained non-numeric characters. Correct them and try again.');
      return;
    }
    const partyVotesPayload = Object.entries(clean).map(([partyId, votes]) => ({
      partyId,
      votes: Number(votes),
    }));

    const fields = {
      ...draft,
      pollingUnitId: user.assignedPollingUnitId,
      partyVotes: JSON.stringify(partyVotesPayload),
      captureLat: gps.lat,
      captureLng: gps.lng,
      capturedAt: gps.capturedAt,
      // Per-photo shutter times — the server stores one per photo row.
      photoTimestamps: JSON.stringify(photoMeta),
    };

    try {
      if (navigator.onLine) {
        const formData = new FormData();
        Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
        Object.entries(photos).forEach(([k, blob]) => formData.append(k, blob, `${k}.jpg`));
        const result = await api.submitResult(token, formData);
        setSubmitResult(result);
        clearDraft();
      } else {
        // FR-2.12 — queue locally, retry automatically until it uploads
        await enqueueSubmission({ fields, files: photos });
        setSubmitResult({ queued: true });
        clearDraft();
      }
    } catch (err) {
      if (!navigator.onLine) {
        await enqueueSubmission({ fields, files: photos });
        setSubmitResult({ queued: true });
        clearDraft();
      } else {
        console.error('[submit] result upload failed', { status: err.status, message: err.message, details: err.details });
        setSubmitError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [draft, partyVotes, gps, photos, photoMeta, token, user, clearDraft]);

  // Retry queued submissions whenever connectivity returns
  useEffect(() => {
    const flush = () => flushQueue({ token, submitFn: api.submitResult });
    window.addEventListener('online', flush);
    const interval = setInterval(flush, 60_000);
    flush();
    return () => {
      window.removeEventListener('online', flush);
      clearInterval(interval);
    };
  }, [token]);

  return (
    <SubmissionContext.Provider
      value={{
        stepIndex,
        currentStep: STEPS[stepIndex],
        goNext,
        goBack,
        draft,
        updateDraft,
        partyVotes,
        updatePartyVotes,
        seedPartyVotes,
        photos,
        setPhotos,
        photoPreviews,
        setPhotoPreviews,
        photoConfirmed,
        setPhotoConfirmed,
        photoMeta,
        setPhotoMeta,
        gps,
        setGps,
        gpsLoading,
        gpsError,
        gpsStatus,
        requestGps,
        startAutoRetryGeolocation,
        stopAutoRetryGeolocation,
        submit,
        submitting,
        submitError,
        submitResult,
      }}
    >
      {children}
    </SubmissionContext.Provider>
  );
}

export function useSubmission() {
  const ctx = useContext(SubmissionContext);
  if (!ctx) throw new Error('useSubmission must be used within SubmissionProvider');
  return ctx;
}