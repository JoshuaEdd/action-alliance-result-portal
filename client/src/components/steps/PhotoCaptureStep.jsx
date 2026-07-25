import { useState } from 'react';
import { useSubmission } from '../../context/SubmissionContext';
import CameraCapture from '../CameraCapture';
import ActionBar from '../ActionBar';

const SLOTS = [
  { key: 'agentTagPhoto', label: 'Polling unit agent tag photo' },
  { key: 'resultSheetPhoto', label: 'Polling unit result sheet photo' },
  { key: 'agentPassportPhoto', label: "Agent's passport photo" },
];

export default function PhotoCaptureStep() {
  const { photos, setPhotos, gps, setGps, goNext, goBack } = useSubmission();
  const [previews, setPreviews] = useState({});
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);

  const captureGpsIfNeeded = () => {
    if (gps || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          capturedAt: new Date().toISOString(),
        });
        setLocating(false);
      },
      () => {
        setLocationError('Could not read GPS location. Enable location access and try again.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleCapture = (key) => (blob, previewUrl) => {
    setPhotos((p) => ({ ...p, [key]: blob }));
    setPreviews((p) => ({ ...p, [key]: previewUrl }));
    captureGpsIfNeeded(); // FR-2.7 — GPS + timestamp at moment of capture
  };

  const allCaptured = SLOTS.every((s) => photos[s.key]);
  const canContinue = allCaptured && !!gps;

  return (
    <>
      <div className="step-content">
        <h2>Capture required photos</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: 14, marginBottom: 16 }}>
          Live camera only — gallery uploads aren't accepted for any of these.
        </p>
        {SLOTS.map((s) => (
          <CameraCapture
            key={s.key}
            label={s.label}
            captured={previews[s.key]}
            onCapture={handleCapture(s.key)}
          />
        ))}
        {locating && <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Reading GPS location…</p>}
        {locationError && <p className="error-text">{locationError}</p>}
      </div>
      <ActionBar onBack={goBack} onNext={goNext} nextDisabled={!canContinue} />
    </>
  );
}
