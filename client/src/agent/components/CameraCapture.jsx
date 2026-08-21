import { useEffect, useRef, useState, useCallback } from 'react';

// Captures only through the device camera — there is deliberately no
// <input type="file"> fallback (FR-2.6). The live feed is rear-facing by
// default (surveillance-style shot of the paper sheet) and can toggle to
// the user/front camera for the agent passport.
//
// Reliability rules learned the hard way:
//  - getUserMedia only exists in secure contexts (HTTPS/localhost). We check
//    up front and say so plainly instead of failing with a vague message.
//  - Browser errors are named (NotAllowedError / NotFoundError /
//    NotReadableError) because each needs a different fix on the agent's side.
//  - The shutter stays disabled until the <video> is actually delivering
//    frames (loadedmetadata + videoWidth > 0). Grabbing a frame earlier used
//    to produce a 0x0 canvas → null blob → "blank" photo that never uploaded.
//  - Every capture stamps its OWN wall-clock time at shutter press (not the
//    GPS-fix time), so a poor connection can never blur when photos were
//    actually taken. The timestamp rides along to the server and is also
//    baked into the photo as a very bold watermark band pair.
export default function CameraCapture({ label, onCapture, captured, geo, defaultFacing = 'environment' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null); // { title, detail }
  const [active, setActive] = useState(false);
  const [stream, setStream] = useState(null);
  const [facing, setFacing] = useState(defaultFacing);
  const [videoReady, setVideoReady] = useState(false);
  const [flashing, setFlashing] = useState(false);

  // Secure context + API support — without HTTPS the camera simply cannot
  // work, and the agent deserves to know that's the reason.
  const supportError = (() => {
    if (typeof window === 'undefined') return null;
    if (!window.isSecureContext) {
      return {
        title: 'Insecure connection',
        detail: 'Camera access requires HTTPS. Open this page using its https:// address and try again.',
      };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return {
        title: 'Camera not supported',
        detail: 'This browser does not expose camera access. Use an updated Chrome, Edge, Firefox, or Safari.',
      };
    }
    return null;
  })();

  const startCamera = useCallback(async (requestedFacing = facing) => {
    if (supportError) {
      setError(supportError);
      return;
    }
    setError(null);
    setVideoReady(false);
    setActive(true); // mount the <video> first so the frame exists
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: requestedFacing,
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = mediaStream;
      setStream(mediaStream);
    } catch (err) {
      const named = {
        NotAllowedError: {
          title: 'Camera permission blocked',
          detail: 'Allow camera access for this site (tap the lock/camera icon in the address bar), then tap Open camera again.',
        },
        PermissionDeniedError: {
          title: 'Camera permission blocked',
          detail: 'Allow camera access for this site (tap the lock/camera icon in the address bar), then tap Open camera again.',
        },
        NotFoundError: {
          title: 'No camera found',
          detail: 'This device does not have a camera this page can use.',
        },
        DevicesNotFoundError: {
          title: 'No camera found',
          detail: 'This device does not have a camera this page can use.',
        },
        NotReadableError: {
          title: 'Camera is busy',
          detail: 'Another app is using the camera. Close it, then tap Open camera again.',
        },
        TrackStartError: {
          title: 'Camera is busy',
          detail: 'Another app is using the camera. Close it, then tap Open camera again.',
        },
      };
      setError(named[err?.name] || {
        title: 'Could not open camera',
        detail: `${err?.name || 'Unknown error'} — close other apps using the camera and try again.`,
      });
      setActive(false);
      setStream(null);
    }
  }, [facing, supportError]);

  // Attach the stream once both the <video> element and the stream exist.
  useEffect(() => {
    if (active && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [active, stream]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const handleMetadata = () => {
    const v = videoRef.current;
    if (v && v.videoWidth > 0) setVideoReady(true);
  };

  const flipCamera = () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    startCamera(next);
  };

  // ── Very bold watermark ────────────────────────────────────────────
  // Two full-width solid bands (top + bottom) so nothing can be cropped
  // out. Sizes scale with image width: ~5% of width for the headline
  // timestamp, so it stays huge on any resolution.
  const drawWatermark = (ctx, w, h, capturedAt) => {
    const timeStr = capturedAt.toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const coordStr = geo
      ? `LAT ${geo.lat.toFixed(6)}   LON ${geo.lng.toFixed(6)}   ±${Math.round(geo.accuracy)}m`
      : 'NO GPS FIX';
    const placeStr = geo?.placeName ? geo.placeName.toUpperCase() : '';

    ctx.save();
    ctx.textBaseline = 'middle';

    // ── Bottom band: timestamp (huge) + coordinates ──
    const bigSize = Math.max(30, Math.round(w * 0.052));
    const midSize = Math.max(20, Math.round(w * 0.034));
    const pad = Math.round(w * 0.03);
    const lineGap = Math.round(bigSize * 0.35);
    const bandH = pad * 1.4 + bigSize + midSize * 2 + lineGap * 2;

    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, h - bandH, w, bandH);

    let y = h - bandH + pad * 0.7 + bigSize / 2;
    ctx.fillStyle = '#FF9F00'; // AA orange — maximum contrast on black
    ctx.font = `800 ${bigSize}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(timeStr, pad, y);

    y += bigSize / 2 + lineGap + midSize / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${midSize}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(coordStr, pad, y);

    if (placeStr) {
      y += midSize / 2 + lineGap + midSize / 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `700 ${midSize}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.fillText(placeStr.slice(0, 48), pad, y);
    }

    // ── Top band: geotag banner ──
    const topH = Math.max(34, Math.round(w * 0.058));
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, w, topH);
    ctx.fillStyle = '#00E676';
    ctx.font = `800 ${Math.max(18, Math.round(w * 0.032))}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(geo ? 'GEO-TAGGED CAPTURE' : 'UNVERIFIED LOCATION', pad, topH / 2);
    ctx.restore();
  };

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return; // shutter is gated anyway

    setFlashing(true);
    setTimeout(() => setFlashing(false), 220);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Actual wall-clock time of THIS shutter press — never reused from GPS.
    const capturedAt = new Date();
    drawWatermark(ctx, canvas.width, canvas.height, capturedAt);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError({ title: 'Capture failed', detail: 'The photo could not be processed. Tap Open camera and try again.' });
          return;
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setActive(false);
        setStream(null);
        setVideoReady(false);
        onCapture(blob, URL.createObjectURL(blob), capturedAt.toISOString());
      },
      'image/jpeg',
      0.85
    );
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div className={`camera-frame ${active && !captured ? 'is-live' : ''}`}>
        {captured ? (
          <img src={captured} alt={`${label} preview`} />
        ) : active ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={handleMetadata} />
            <div className="guide-overlay" />
            <div className="scan-line" />
            {flashing && <div className="capture-flash" />}
            {!videoReady && !error && <div className="camera-warming">Starting camera…</div>}
          </>
        ) : null}
      </div>
      {error && (
        <div className="camera-error">
          <strong>{error.title}</strong>
          <span>{error.detail}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {captured ? (
          <button type="button" className="btn btn-secondary" onClick={() => startCamera()}>Retake</button>
        ) : active ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={flipCamera}>
              {facing === 'environment' ? 'Front' : 'Back'}
            </button>
            <button
              type="button"
              className="btn-shutter"
              onClick={takePhoto}
              disabled={!videoReady}
              aria-label="Capture photo"
            />
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => startCamera()} disabled={!!supportError}>
            Open camera
          </button>
        )}
      </div>
    </div>
  );
}
