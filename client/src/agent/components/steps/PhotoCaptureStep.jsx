import { useEffect, useState, useCallback, useRef } from 'react';
import { useSubmission } from '../../context/SubmissionContext';
import { logCapture } from '../../../api/offlineQueue';
import CameraCapture from '../CameraCapture';
import ActionBar from '../ActionBar';

const SLOTS = [
  { key: 'agentTagPhoto', label: 'Polling unit agent tag photo' },
  { key: 'resultSheetPhoto', label: 'Polling unit result sheet photo' },
  { key: 'agentPassportPhoto', label: "Agent's passport photo", defaultFacing: 'user' },
];

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

// Precise location is a hard gate on this step, not an afterthought: the
// browser permission is requested up front and live capture is rejected
// until a high-accuracy fix is granted (SEC-7 / FR-2.7). The same fix is
// stamped onto every photo as a watermark for the admin record.
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
  // field. The same clearing-on-tap means a re-tap (a fresh user gesture,
  // which browsers answer far quicker than a non-gesture request) restarts
  // cleanly instead of two requests fighting over the one prompt.
  const watchRef = useRef(null);

  const requestPreciseLocation = useCallback(() => {
    setLocating(true);
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocating(false);
      setLocationError('Location is not supported by this browser. Use a modern browser over HTTPS.');
      return;
    }

    // Drop any in-flight request first. StrictMode double-mounts effects in
    // dev (and fast finger taps re-fire this) — stacking concurrent requests
    // made the loser's error callback override the winner's fix, leaving the
    // step stuck on "precise location required" after access was granted.
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
            ? 'Getting a precise fix is taking too long. Move to open sky if possible and retry.'
            : 'Your device could not provide a location. Check that location services are on, then retry.';
        setLocationError(named);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [setGps]);

  useEffect(() => {
    requestPreciseLocation();
  }, [requestPreciseLocation]);

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
                <div style={{ fontWeight: 700, fontSize: 14 }}>Precise location required</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
                  Photo capture is disabled until your precise location is granted. This is used to verify the capture
                  point against your polling unit.
                </div>
              </div>
            </div>
            {locating && <p style={{ fontSize: 13, color: 'var(--ink-soft)', padding: '0 16px 8px' }}>Requesting location…</p>}
            {locationError && <p className="error-text" style={{ padding: '0 16px 8px' }}>{locationError}</p>}
            {!locating && (
              <div style={{ padding: '0 16px 16px' }}>
                <button type="button" className="btn btn-primary" onClick={requestPreciseLocation}>
                  Grant precise location
                </button>
              </div>
            )}
            {locating && (
              <div style={{ padding: '0 16px 16px' }}>
                <button type="button" className="btn btn-secondary" onClick={requestPreciseLocation}>
                  Retry precise location
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="gps-chip-row">
            <span className="chip chip-ok">GPS locked ±{Math.round(gps.accuracy)}m</span>
            <span className="chip">{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</span>
          </div>
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
