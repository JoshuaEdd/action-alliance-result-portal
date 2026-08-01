import { useEffect, useRef, useState, useCallback } from 'react';

// Captures only through the device camera — there is deliberately no
// <input type="file"> fallback, so gallery upload is disabled for every
// photo type (FR-2.6). A framing/lighting guide overlay reduces retakes (FR-2.8).
export default function CameraCapture({ label, onCapture, captured }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);
  const [stream, setStream] = useState(null);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setActive(true);
    } catch {
      setError('Camera access is required to capture this photo.');
    }
  }, []);

  // The <video> element only mounts once `active` is true, so the stream
  // can't be attached synchronously inside startCamera (the ref is still
  // null at that point) — this runs after React commits the new element.
  useEffect(() => {
    if (active && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [active, stream]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const takePhoto = () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setActive(false);
        onCapture(blob, URL.createObjectURL(blob));
      },
      'image/jpeg',
      0.85
    );
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div className="camera-frame">
        {captured ? (
          <img src={captured} alt={`${label} preview`} />
        ) : active ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="guide-overlay" />
          </>
        ) : null}
      </div>
      {error && <p className="error-text">{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {captured ? (
          <button type="button" className="btn btn-secondary" onClick={startCamera}>Retake</button>
        ) : active ? (
          <button type="button" className="btn btn-primary" onClick={takePhoto}>Capture</button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={startCamera}>Open camera</button>
        )}
      </div>
    </div>
  );
}
