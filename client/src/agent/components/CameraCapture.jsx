import { useEffect, useRef, useState, useCallback } from 'react';

// Captures only through the device camera — there is deliberately no
// <input type="file"> fallback (FR-2.6). The live feed is rear-facing by
// default (surveillance-style shot of the paper sheet) and can toggle to
// the user/front camera for the agent passport. A timestamp + GPS
// watermark is baked into every capture so only an admin inspecting the
// record can see the original capture context (the agent never sees it
// during the wizard).
export default function CameraCapture({ label, onCapture, captured, watermark, defaultFacing = 'environment' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(false);
  const [stream, setStream] = useState(null);
  const [facing, setFacing] = useState(defaultFacing);

  const startCamera = useCallback(async (requestedFacing = facing) => {
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: requestedFacing,
          width: { ideal: 1280 },
        },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setActive(true);
    } catch {
      setError('Camera access is required to capture this photo.');
    }
  }, [facing]);

  // Attach the stream once the <video> element exists (it mounts after `active`).
  useEffect(() => {
    if (active && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [active, stream]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const flipCamera = () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    startCamera(next);
  };

  const drawWatermark = (ctx, w, h) => {
    if (!watermark) return;
    ctx.save();
    ctx.font = '600 18px ui-monospace, monospace';
    const tw = ctx.measureText(watermark).width;
    const pad = 12;
    const x = Math.max(4, w - tw - pad - 18); // don't push off the left edge
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, h - 48, tw + 30, 38);
    ctx.fillStyle = '#fff';
    ctx.fillText(watermark, x + 4, h - 23);
    ctx.restore();
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    drawWatermark(ctx, canvas.width, canvas.height);
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
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {captured ? (
          <button type="button" className="btn btn-secondary" onClick={() => startCamera()}>Retake</button>
        ) : active ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={flipCamera}>
              {facing === 'environment' ? 'Use front camera' : 'Use back camera'}
            </button>
            <button type="button" className="btn btn-primary" onClick={takePhoto}>Capture</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => startCamera()}>Open camera</button>
        )}
      </div>
    </div>
  );
}