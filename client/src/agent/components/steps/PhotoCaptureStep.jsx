import { useEffect, useState, useCallback } from 'react';
import { useSubmission } from '../../context/SubmissionContext';
import { useAuth } from '../../../context/AuthContext';
import { logCapture } from '../../../api/offlineQueue';
import { api } from '../../../api/client';
import CameraCapture from '../CameraCapture';
import ActionBar from '../ActionBar';

const SLOTS = [
  { key: 'agentTagPhoto', label: 'Polling unit agent tag photo' },
  { key: 'resultSheetPhoto', label: 'Polling unit result sheet photo' },
  { key: 'agentPassportPhoto', label: "Agent's passport photo" },
];

// All three captures use the rear camera — including the passport shot. The
// camera default in CameraCapture is 'environment', so no defaultFacing is
// needed here; the manual front/back toggle in the viewfinder still exists as
// a fallback if a device's rear camera is unavailable.

// Location is a hard gate — there is no "continue without location" (req).
// The fix is auto-retried until obtained: the loop lives in SubmissionContext
// and this step just reflects its state via gpsStatus.
//  - 'locating'  → the browser permission/capture request is in flight
//  - 'retrying'  → no fix yet, retrying automatically every 5s
//  - 'error'     → permission hard-blocked; still retrying, just slower
//  - 'active'    → a fix is held; capture and the rest of the flow unlock
const STATUS_TEXT = {
  locating: 'Getting location…',
  retrying: 'Location not available — retrying automatically…',
  error: 'Location is blocked. Enable it for this site — still retrying in the background…',
  active: 'Location active',
};

const COARSE_METERS = 200;
export default function PhotoCaptureStep() {
  const { token } = useAuth();
  const {
    photos,
    setPhotos,
    photoMeta,
    setPhotoMeta,
    gps,
    gpsError,
    gpsStatus,
    requestGps,
    startAutoRetryGeolocation,
    stopAutoRetryGeolocation,
    goNext,
    goBack,
  } = useSubmission();
  const [previews, setPreviews] = useState({});
  const [locating, setLocating] = useState(false);
  // The agent's assigned polling unit, burned onto every photo stamp so the
  // submitted sheet is self-identifying even before it's matched in the DB.
  const [site, setSite] = useState('');

  useEffect(() => {
    api
      .getMyPollingUnit(token)
      .then((pu) => {
        if (pu?.name) setSite(`PU ${pu.pu_number} — ${pu.name}`);
      })
      .catch(() => {});
  }, [token]);

  // Auto-retry the fix for as long as this step is on screen (and never let
  // the agent capture or continue without one). Bail cleanly on unmount.
  useEffect(() => {
    if (!gps) startAutoRetryGeolocation();
    return () => stopAutoRetryGeolocation();
  }, [gps, startAutoRetryGeolocation, stopAutoRetryGeolocation]);

  const requestPreciseLocation = useCallback(async () => {
    setLocating(true);
    try {
      await requestGps();
    } catch {
      // the auto-retry loop takes over; nothing to do here
    } finally {
      setLocating(false);
    }
  }, [requestGps]);

  const handleCapture = (key) => (blob, previewDataUrl, capturedAt) => {
    setPhotos((p) => ({ ...p, [key]: blob }));
    // previewDataUrl is a data: URL minted synchronously from the canvas at
    // shutter press — guaranteed to render in the <img> on every device.
    setPreviews((p) => ({ ...p, [key]: previewDataUrl }));
    setPhotoMeta((m) => ({ ...m, [key]: capturedAt }));
    // Durable local audit trail — written even with zero connectivity so a
    // dropped signal can never erase when/where this photo was taken.
    logCapture({
      slot: key,
      capturedAt,
      lat: gps?.lat ?? null,
      lng: gps?.lng ?? null,
      accuracy: gps?.accuracy ?? null,
    }).catch(() => {});
  };

  const allCaptured = SLOTS.every((s) => photos[s.key]);
  const canContinue = allCaptured && Boolean(gps);

  return (
    <>
      <div className="step-content">
        <h2>Capture required photos</h2>
        <p className="step-hint">
          Live camera only — gallery uploads aren't accepted for any of these.
        </p>

        {!gps ? (
          <div className="card notice-card">
            <div className="notice-head">
              <span className="notice-dot">📍</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Location required</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
                  Photo capture is locked until your device supplies a location. When your phone asks
                  about location access, choose <strong>Allow</strong> and <strong>Precise</strong>.
                  This app keeps trying on its own until a fix is available — uploads are not possible
                  without it.
                </div>
              </div>
            </div>
            <p
              className="geo-status"
              role="status"
              style={{ fontSize: 13, padding: '10px 16px 0', color: gpsStatus === 'error' ? 'var(--error-red)' : 'var(--ink-soft)' }}
            >
              {STATUS_TEXT[gpsStatus] || STATUS_TEXT.locating}
            </p>
            {gpsError && gpsStatus === 'error' && <p className="error-text" style={{ padding: '0 16px 8px' }}>{gpsError}</p>}
            <div style={{ padding: '0 16px 16px' }}>
              <button type="button" className={locating ? 'btn btn-secondary' : 'btn btn-primary'} onClick={requestPreciseLocation}>
                {locating ? 'Requesting…' : 'Request location now'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="gps-chip-row">
              {gps.accuracy > COARSE_METERS ? (
                <span className="chip chip-warn">Approximate fix ±{Math.round(gps.accuracy)}m</span>
              ) : (
                <span className="chip chip-ok">GPS locked ±{Math.round(gps.accuracy)}m</span>
              )}
              <span className="chip">{gps.street ? gps.street : gps.placeName ? gps.placeName : gps.approximatePlace ? gps.approximatePlace : `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`}</span>
            </div>
            {gps.accuracy > COARSE_METERS && (
              <p className="step-hint" style={{ marginTop: -8, marginBottom: 16 }}>
                This looks like an approximate fix (±{Math.round(gps.accuracy)}m). For a tighter record,
                choose Precise in the location permission pop-up or your phone's location settings.
              </p>
            )}
          </>
        )}

        {gps &&
          SLOTS.map((s) => (
            <div key={s.key}>
              <CameraCapture
                label={s.label}
                captured={previews[s.key]}
                onCapture={handleCapture(s.key)}
                geo={gps}
                defaultFacing={s.defaultFacing}
                site={site}
              />
              {photoMeta[s.key] && (
                <p className="capture-time">
                  Captured {new Date(photoMeta[s.key]).toLocaleString()}
                </p>
              )}
            </div>
          ))}
      </div>
      <ActionBar onBack={goBack} onNext={goNext} nextDisabled={!canContinue} />
    </>
  );
}