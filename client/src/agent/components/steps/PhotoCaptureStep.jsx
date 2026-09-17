import { useEffect, useState, useCallback, useRef } from 'react';
import { useSubmission } from '../../context/SubmissionContext';
import { logCapture } from '../../../api/offlineQueue';
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

// Reverse-geocodes a capture point into a human-readable place name (OSM
// Nominatim). Falls back to null so the stamp degrades gracefully to raw
// coordinates when offline or rate-limited.
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    const area =
      a.road || a.neighbourhood || a.suburb || a.village || a.town || a.city || a.city_district;
    const region = a.state_district || a.state || a.county;
    const name = [area, region].filter(Boolean).join(', ');
    return name ? name.slice(0, 70) : null;
  } catch {
    return null;
  }
}

// Location is a gate on this step, not an afterthought: the browser
// permission is requested from the button tap and live capture stays locked
// until a fix is granted (SEC-7 / FR-2.7). The same fix is stamped onto every
// photo as a watermark for the admin record.
//
// Two hard lessons from the field shaped this logic:
//  - The request fires ONLY from a tap. An auto-request on page mount is not
//    a user gesture, and phones (esp. iOS Safari) often refuse to show the
//    permission pop-up for it — the step then waits forever with no prompt.
//    Starting on tap makes the pop-up appear deterministically.
//  - We never refuse to unlock on accuracy. Some phones answer the pop-up
//    with "Approximate", giving a coarse fix; a hard no-go waiting for a
//    tighter reading is what kept bricking photo capture. Any real fix now
//    unlocks capture — an approximate one is just flagged with a warning chip
//    so the agent (and the admin record) can see the accuracy honestly.
// A fix fresher than 30s is reused so a returning agent unlocks instantly.
const COARSE_METERS = 200;
export default function PhotoCaptureStep() {
  const { photos, setPhotos, photoMeta, setPhotoMeta, gps, setGps, goNext, goBack } = useSubmission();
  const [previews, setPreviews] = useState({});
  const [locating, setLocating] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [locationError, setLocationError] = useState(null);
  // A single in-flight geolocation watch per step. getCurrentPosition waits
  // for one final, most-accurate reading before returning, which can stall
  // for the full timeout indoors/under tree cover; watchPosition hands back a
  // fix as soon as the browser has one and refines it in later updates, so
  // we clear the watch on the first successful reading — much faster in the
  // field. A re-tap clears any in-flight watch and restarts cleanly instead
  // of two requests fighting over the one prompt.
  const watchRef = useRef(null);

  const requestPreciseLocation = useCallback(() => {
    setLocating(true);
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocating(false);
      setLocationError('Location is not supported by this browser. Use a modern browser over HTTPS.');
      return;
    }

    // Drop any in-flight request first (StrictMode dev double-mounts and fast
    // taps re-fire this — stacked requests made the loser's error callback
    // override the winner's fix and lock the step).
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }

    const finish = () => {
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const capturedAt = new Date().toISOString();
        finish();
        setLocationError(null);
        setGps({ lat, lng, capturedAt, accuracy });
        setLocationReady(true);
        setLocating(false);
        // Stamp the human-readable place name onto photos when we can
        // resolve it (async; falls back to raw coordinates).
        reverseGeocode(lat, lng).then((placeName) => {
          setGps((g) => (g ? { ...g, placeName } : g));
        });
      },
      (err) => {
        finish();
        setLocationReady(false);
        const named = err?.code === err?.PERMISSION_DENIED
          ? 'Location permission is blocked for this site. Allow it in the address bar settings, then tap retry.'
          : err?.code === err?.TIMEOUT
            ? 'Getting a fix is taking longer than usual. Move to open sky if possible, then tap to retry.'
            : 'Your device could not provide a location. Check that location services are on, then tap to retry.';
        setLocationError(named);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 }
    );
  }, [setGps]);

  // Field escape hatch: if this device simply cannot produce a fix (no GPS,
  // permission hard-blocked, insecure origin), the agent can still work. The
  // photos then stamp "UNVERIFIED LOCATION" / "NO GPS FIX" so the admin can
  // see at a glance that the capture point is not geotagged.
  const skipLocation = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setLocating(false);
    setLocationError(null);
    setLocationReady(true);
  }, []);

  useEffect(() => () => {
    // Release the watch if the agent leaves this step mid-request.
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
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
                Photos without a fix are stamped <strong>UNVERIFIED LOCATION</strong> and stand out in
                verification.
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
                  <span className="chip">{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</span>
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
                No GPS fix — capture will be stamped <strong>UNVERIFIED LOCATION</strong>. If your phone can
                share location, go back a step and grant precise access for a geotagged record.
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
