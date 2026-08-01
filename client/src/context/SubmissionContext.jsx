import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { enqueueSubmission, flushQueue } from '../api/offlineQueue';
import { useAuth } from './AuthContext';

const SubmissionContext = createContext(null);
const DRAFT_KEY = 'result-draft-v1';

export const STEPS = ['location', 'votes', 'agent', 'photos', 'preview'];

const emptyDraft = {
  totalRegisteredVoters: '',
  totalAccreditedVoters: '',
  totalValidVotes: '',
  totalInvalidVotes: '',
  totalVotes: '',
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
  // Photo blobs are kept in memory only (FR-2.6/2.7) — large binary data isn't
  // suited to localStorage; a background sync worker would be the next step
  // if the app needs to survive a full process kill mid-capture.
  const [photos, setPhotos] = useState({}); // { agentTagPhoto, resultSheetPhoto, agentPassportPhoto }
  const [gps, setGps] = useState(null); // { lat, lng, capturedAt } from photo capture step
  const [submitResult, setSubmitResult] = useState(null); // { referenceNumber, status } | { queued: true }
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // FR-2.11 — auto-save local draft as the agent progresses
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  const updateDraft = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), []);

  const goNext = useCallback(() => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1)), []);
  const goBack = useCallback(() => setStepIndex((i) => Math.max(i - 1, 0)), []);

  const clearDraft = useCallback(() => {
    setDraft(emptyDraft);
    setPhotos({});
    setGps(null);
    setStepIndex(0);
    localStorage.removeItem(DRAFT_KEY);
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    const fields = {
      ...draft,
      pollingUnitId: user.assignedPollingUnitId,
      captureLat: gps?.lat,
      captureLng: gps?.lng,
      capturedAt: gps?.capturedAt,
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
  }, [draft, gps, photos, token, user, clearDraft]);

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
        photos,
        setPhotos,
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
