import { useEffect, useRef, useState, useCallback } from 'react';

// Captures only through the device camera — there is deliberately no
// <input type="file"> fallback (FR-2.6). The live feed is rear-facing by
// default (surveillance-style shot of the paper sheet) and can toggle to
// the user/front camera as a fallback for agents whose rear camera is busy
// or broken.
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
//    baked into the photo as a compact bottom watermark strip.
export default function CameraCapture({ label, onCapture, captured, confirmed = false, onConfirm, onRetake, geo, defaultFacing = 'environment', site = '' }) {
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
    // Release any stream we already hold BEFORE asking for a new one. If a
    // previous stream is still running on the same camera hardware (as when
    // flipping front/back or retaking a photo), the browser treats it as
    // "another app using the camera" and rejects the request with a busy
    // NotReadableError — that is exactly the error agents keep hitting.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
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
      streamRef.current = mediaStream;
      setStream(mediaStream);
    } catch (err) {
      const named = {
        NotAllowedError: {
          title: 'Camera permission blocked',
          detail: 'Allow camera access for this site (tap the lock/camera icon in the address bar), then tap Click to Capture again.',
        },
        PermissionDeniedError: {
          title: 'Camera permission blocked',
          detail: 'Allow camera access for this site (tap the lock/camera icon in the address bar), then tap Click to Capture again.',
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
          detail: 'Another app is using the camera. Close it, then tap Click to Capture again.',
        },
        TrackStartError: {
          title: 'Camera is busy',
          detail: 'Another app is using the camera. Close it, then tap Click to Capture again.',
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
    if (!v || v.videoWidth === 0) return;
    // Wait for an actually-rendered frame, not just video dimensions. Tapping
    // the shutter the moment metadata lands can otherwise capture a black
    // frame that previews as a dark box.
    const unlock = () => setVideoReady(true);
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(unlock);
    } else if (typeof v.webkitRequestVideoFrameCallback === 'function') {
      v.webkitRequestVideoFrameCallback(unlock);
    } else {
      unlock();
    }
  };

  const flipCamera = () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    startCamera(next);
  };

  // Discard the prior capture (parent removes the blob/preview/confirmation)
  // and bring the live viewfinder straight back.
  const handleRetake = () => {
    onRetake?.();
    startCamera();
  };

  // ── Subtle single-band watermark ─────────────────────────────────
  // One compact translucent strip along the bottom: capture time, then
  // coordinates / place / polling unit when known. No top banner and no
  // "UNVERIFIED LOCATION" shout — a GPS-less shot simply carries its
  // timestamp, and the records show the coordinate gap instead.
  const drawWatermark = (ctx, w, h, capturedAt, site) => {
    const timeStr = capturedAt.toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    const coordStr = geo
      ? `LAT ${geo.lat.toFixed(6)}   LON ${geo.lng.toFixed(6)}   ±${Math.round(geo.accuracy)}m`
      : null;
    const placeStr = geo?.placeName ? geo.placeName.toUpperCase().slice(0, 52) : null;
    const siteStr = site || null;

    const lines = [timeStr];
    if (coordStr) lines.push(coordStr);
    if (placeStr) lines.push(placeStr);
    if (siteStr) lines.push(siteStr);

    ctx.save();
    ctx.textBaseline = 'middle';

    const pad = Math.round(w * 0.02);
    const mainSize = Math.max(15, Math.round(w * 0.026)); // timestamp
    const subSize = Math.max(11, Math.round(w * 0.02));   // coord/place/site
    const lineGap = Math.round(subSize * 0.45);
    const bandH = pad * 2 + mainSize + (lines.length - 1) * (subSize + lineGap);

    ctx.fillStyle = 'rgba(11, 16, 35, 0.7)';
    ctx.fillRect(0, h - bandH, w, bandH);

    let y = h - bandH + pad + mainSize / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${mainSize}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(timeStr, pad, y);

    for (let i = 1; i < lines.length; i++) {
      y += subSize / 2 + lineGap + subSize / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.font = `600 ${subSize}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.fillText(lines[i], pad, y);
    }
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
    drawWatermark(ctx, canvas.width, canvas.height, capturedAt, site);

    // Preview comes from a synchronous data URL, not a blob object URL: data
    // URLs always render in an <img> (URL.createObjectURL can fail to load on
    // some devices). The blob below is still what gets uploaded.
    const previewDataUrl = canvas.toDataURL('image/jpeg', 0.85);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError({ title: 'Capture failed', detail: 'The photo could not be processed. Tap Click to Capture and try again.' });
          return;
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setActive(false);
        setStream(null);
        setVideoReady(false);
        onCapture(blob, previewDataUrl, capturedAt.toISOString());
      },
      'image/jpeg',
      0.85
    );
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div className={`camera-frame ${active ? 'is-live' : ''}`}>
        {captured && !active ? (
          <img src={captured} alt={`${label} preview`} />
        ) : active ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={handleMetadata} />
            <div className="guide-overlay" />
            <div className="scan-line" />
            {flashing && <div className="capture-flash" />}
            {!videoReady && !error && <div className="camera-warming">Starting camera…</div>}
          </>
        ) : (
          <div className="camera-placeholder">
            <span className="camera-placeholder-icon" aria-hidden="true">📷</span>
            <span className="camera-placeholder-text">Camera is off</span>
            <span className="camera-placeholder-hint">Tap &ldquo;Click to Capture&rdquo; below to open the live camera and take this photo.</span>
          </div>
        )}
      </div>
      {error && (
        <div className="camera-error">
          <strong>{error.title}</strong>
          <span>{error.detail}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {captured && !active ? (
          confirmed ? (
            <div className="capture-confirm-bar">
              <span className="capture-confirmed">✓ Captured and accepted</span>
              <button type="button" className="btn btn-secondary" onClick={handleRetake}>Change photo</button>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={handleRetake}>Retake</button>
              <button type="button" className="btn btn-primary" onClick={onConfirm}>Use Photo</button>
            </>
          )
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
            >
              <span className="btn-shutter-icon" aria-hidden="true">📷</span>
              <span className="btn-shutter-label">Tap to Capture</span>
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => startCamera()} disabled={!!supportError}>
            Click to Capture
          </button>
        )}
      </div>
    </div>
  );
}
