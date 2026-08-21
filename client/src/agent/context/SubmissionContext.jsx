import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { enqueueSubmission, flushQueue } from '../../api/offlineQueue';
import { useAuth } from '../../context/AuthContext';

const SubmissionContext = createContext(null);
const DRAFT_KEY = 'result-draft-v1';

export const STEPS = ['location', 'votes', 'agent', 'photos', 'preview'];

const emptyDraft = {
  totalRegisteredVoters: '',
  totalAccreditedVoters: '',
  totalInvalidVotes: '',
  submittingAgentName: '',
  submittingAgentPhone: '',
};

export function SubmissionProvider({ children }) {
  const { token, user } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      return saved ? { ...emptyDraft, ...JSON.parse(saved) } : emptyDraft;
    } catch {
      return emptyDraft;
    }
  });
  // Per-party vote counts: { [partyId]: '123' }. Kept separate from draft's
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
  // Exact wall-clock ISO time of each shutter press, keyed like photos.
  // Travels with the submission so the server can store per-photo capture
  // times even when everything arrives hours later via the offline queue.
  const [photoMeta, setPhotoMeta] = useState({});
  const [gps, setGps] = useState(null); // { lat, lng, capturedAt } from photo capture step
  const [submitResult, setSubmitResult] = useState(null); // { referenceNumber, status } | { queued: true }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // FR-2.11 — auto-save local draft as the agent progresses
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    localStorage.setItem(`${DRAFT_KEY}:parties`, JSON.stringify(partyVotes));
  }, [partyVotes]);

  const updatePartyVotes = useCallback((patch) => setPartyVotes((p) => ({ ...p, ...patch })), []);

  const updateDraft = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), []);

  const goNext = useCallback(() => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1)), []);
  const goBack = useCallback(() => setStepIndex((i) => Math.max(i - 1, 0)), []);

  const clearDraft = useCallback(() => {
    setDraft(emptyDraft);
    setPartyVotes({});
    setPhotos({});
    setPhotoMeta({});
    setGps(null);
    setStepIndex(0);
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(`${DRAFT_KEY}:parties`);
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    const partyVotesPayload = Object.entries(partyVotes)
      .filter(([, votes]) => votes !== '' && votes !== undefined)
      .map(([partyId, votes]) => ({ partyId, votes: Number(votes) }));

    const fields = {
      ...draft,
      pollingUnitId: user.assignedPollingUnitId,
      partyVotes: JSON.stringify(partyVotesPayload),
      captureLat: gps?.lat,
      captureLng: gps?.lng,
      capturedAt: gps?.capturedAt,
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
        photos,
        setPhotos,
        photoMeta,
        setPhotoMeta,
        gps,
        setGps,
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
