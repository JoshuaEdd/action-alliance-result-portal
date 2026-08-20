import { useEffect, useState, useCallback, useRef } from 'react';
import { useSubmission } from '../../context/SubmissionContext';
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
  const { photos, setPhotos, gps, setGps, goNext, goBack } = useSubmission();
  const [previews, setPreviews] = useState({});
  const [locating, setLocating] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const busyRef = useRef(false);

  const requestPreciseLocation = useCallback(() => {
    // StrictMode double-mounts effects in dev, which used to fire two
    // concurrent getCurrentPosition calls — the error callback of the losing
    // call then overrode the winner's success, leaving the step stuck on the
    // "precise location required" panel even after access was granted.
    if (busyRef.current) return;
    busyRef.current = true;
    setLocating(true);
    setLocationError(null);

    if (!navigator.geolocation) {
      busyRef.current = false;
      setLocating(false);
      setLocationError('Location is not supported by this browser. Use a modern browser over HTTPS.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        const capturedAt = new Date().toISOString();
        busyRef.current = false;
        setGps({ lat, lng, capturedAt, accuracy });
        setLocationReady(true);
        setLocating(false);
        // Stamp the human-readable place name onto photos when we can
        // resolve it (async; falls back to raw coordinates).
        reverseGeocode(lat, lng).then((placeName) => {
          setGps((g) => (g ? { ...g, placeName } : g));
        });
      },
      () => {
        busyRef.current = false;
        setLocationReady(false);
        setLocationError(
          'Precise location is required before any photo can be captured. Allow location access for this site, then try again.'
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [setGps]);

  useEffect(() => {
    requestPreciseLocation();
  }, [requestPreciseLocation]);

  const handleCapture = (key) => (blob, previewUrl) => {
    setPhotos((p) => ({ ...p, [key]: blob }));
    setPreviews((p) => ({ ...p, [key]: previewUrl }));
  };

  const watermark = gps
    ? `${new Date(gps.capturedAt).toLocaleString()} · ${gps.placeName || `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`}`
    : null;

  const allCaptured = SLOTS.every((s) => photos[s.key]);
  const canContinue = allCaptured && locationReady;

  return (
    <>
      <div className="step-content">
        <h2>Capture required photos</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 16 }}>
          Live camera only — gallery uploads aren't accepted for any of these.
        </p>

        {!locationReady ? (
          <div className="ledger" style={{ marginBottom: 16 }}>
            <div className="ledger-row">
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Precise location required</div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 4 }}>
                  Photo capture is disabled until your precise location is granted. This is used to verify the capture
                  point against your polling unit.
                </div>
              </div>
            </div>
            {locating && <p style={{ fontSize: 13, color: 'var(--ink-soft)', padding: '0 12px 8px' }}>Requesting location…</p>}
            {locationError && <p className="error-text" style={{ padding: '0 12px 8px' }}>{locationError}</p>}
            {!locating && (
              <div style={{ padding: '0 12px 12px' }}>
                <button type="button" className="btn btn-primary" onClick={requestPreciseLocation}>
                  Grant precise location
                </button>
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--aa-green-dark)', marginBottom: 12 }}>
            Precise location granted — {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)} (±{Math.round(gps.accuracy)}m). Photos
            will be watermarked with this fix.
          </p>
        )}

        {locationReady &&
          SLOTS.map((s) => (
            <CameraCapture
              key={s.key}
              label={s.label}
              captured={previews[s.key]}
              onCapture={handleCapture(s.key)}
              watermark={watermark}
              defaultFacing={s.defaultFacing}
            />
          ))}
      </div>
      <ActionBar onBack={goBack} onNext={goNext} nextDisabled={!canContinue} />
    </>
  );
}