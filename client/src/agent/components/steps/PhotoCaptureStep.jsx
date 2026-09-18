import { useEffect, useState, useCallback } from 'react';
import { useSubmission } from '../../context/SubmissionContext';
import { useAuth } from '../../../context/AuthContext';
import { logCapture } from '../../../api/offlineQueue';
import { api } from '../../../api/client';
import { formatLocationError } from '../../utils/geo';
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

// Location is a gate on this step, not an afterthought: the browser
// permission is requested from the button tap and live capture stays locked
// until a fix is granted (SEC-7 / FR-2.7). The same fix is stamped onto every
// photo as a watermark for the admin record.
//
// Two hard lessons from the field shaped this logic:
//  - The request fires ONLY from a tap if permission was not pre-granted.
//    Starting on tap makes the pop-up appear deterministically.
//  - We never refuse to unlock on accuracy. Some phones answer the pop-up
//    with "Approximate", giving a coarse fix; a hard no-go waiting for a
//    tighter reading is what kept bricking photo capture. Any real fix now
//    unlocks capture — an approximate one is just flagged with a warning chip
//    so the agent (and the admin record) can see the accuracy honestly.
// A fix already in state is reused so a returning agent unlocks instantly.
const COARSE_METERS = 200;
export default function PhotoCaptureStep() {
  const { token } = useAuth();
  const {
    photos,
    setPhotos,
    photoMeta,
    setPhotoMeta,
    gps,
    setGps,
    requestGps,
    gpsLoading,
    goNext,
    goBack,
  } = useSubmission();
  const [previews, setPreviews] = useState({});
  const [locating, setLocating] = useState(false);
  const [locationReady, setLocationReady] = useState(() => Boolean(gps));
  const [locationError, setLocationError] = useState(null);
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

  // Sync locationReady if GPS is acquired (e.g. from background prefetch or context update)
  useEffect(() => {
    if (gps) {
      setLocationReady(true);
      setLocationError(null);
    }
  }, [gps]);

  const requestPreciseLocation = useCallback(async () => {
    setLocating(true);
    setLocationError(null);
    try {
      await requestGps();
      setLocationReady(true);
    } catch (err) {
      setLocationReady(false);
      setLocationError(formatLocationError(err));
    } finally {
      setLocating(false);
    }
  }, [requestGps]);

  // Field escape hatch: if this device simply cannot produce a fix (no GPS,
  // permission hard-blocked, insecure origin), the agent can still work. The
  // photos then carry timestamp-only stamps (no coordinates), so the admin
  // sees at a glance which captures are not geotagged.
  const skipLocation = useCallback(() => {
    setLocating(false);
    setLocationError(null);
    setLocationReady(true);
  }, []);

  const handleCapture = (key) => (blob, previewUrl, capturedAt) => {
    setPhotos((p) => ({ ...p, [key]: blob }));
    setPreviews((p) => ({ ...p, [key]: previewUrl }));
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
  const canContinue = allCaptured && locationReady;

  return (
    <>
      <div className="step-content">
        <h2>Capture required photos</h2>
        <p className="step-hint">
          Live camera only — gallery uploads aren't accepted for any of these.
        </p>

        {!locationReady ? (
          <div className="card notice-card">
            <div className="notice-head">
              <span className="notice-dot">📍</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Location required</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
                  Tap the button to start. When your phone asks about location access, choose{' '}
                  <strong>Allow</strong> and <strong>Precise</strong> — photo capture unlocks as soon as
                  a fix is available. The location is used to verify the capture point against your
                  polling unit.
                </div>
              </div>
            </div>
            {locating && <p style={{ fontSize: 13, color: 'var(--ink-soft)', padding: '0 16px 8px' }}>Requesting location…</p>}
            {locationError && <p className="error-text" style={{ padding: '0 16px 8px' }}>{locationError}</p>}
            <div style={{ padding: '0 16px 16px' }}>
              <button type="button" className={locating ? 'btn btn-secondary' : 'btn btn-primary'} onClick={requestPreciseLocation}>
                {locating ? 'Requesting… (tap to retry)' : 'Grant precise location'}
              </button>
            </div>
            <div style={{ padding: '0 16px 16px' }}>
              <button type="button" className="btn btn-secondary" onClick={skipLocation}>
                Continue without location
              </button>
              <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.5 }}>
                Photos without a fix carry timestamp-only stamps — no GPS coordinates — so they stand
                out in verification.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="gps-chip-row">
              {gps ? (
                <>
                  {gps.accuracy > COARSE_METERS ? (
                    <span className="chip chip-warn">Approximate fix ±{Math.round(gps.accuracy)}m</span>
                  ) : (
                    <span className="chip chip-ok">GPS locked ±{Math.round(gps.accuracy)}m</span>
                  )}
                  <span className="chip">{gps.street ? gps.street : gps.placeName ? gps.placeName : gps.approximatePlace ? gps.approximatePlace : `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`}</span>
                </>
              ) : (
                <span className="chip chip-warn">UNVERIFIED LOCATION</span>
              )}
            </div>
            {gps ? (
              gps.accuracy > COARSE_METERS && (
                <p className="step-hint" style={{ marginTop: -8, marginBottom: 16 }}>
                  This looks like an approximate fix (±{Math.round(gps.accuracy)}m). For a tighter record,
                  choose Precise in the location permission pop-up or your phone's location settings.
                </p>
              )
            ) : (
              <p className="step-hint" style={{ marginTop: -8, marginBottom: 16 }}>
                No GPS fix — captures will be stamped with the timestamp only. If your phone can share
                location, go back a step and grant precise access for a geotagged record.
              </p>
            )}
          </>
        )}

        {locationReady &&
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
