// Geolocation utilities for the agent portal.
// Handles high-accuracy GPS with automatic fallback to coarse/network location,
// error normalization across browsers, and reverse geocoding.

// Reverse-geocodes coordinates into a human-readable street name and approximate location.
// Distinguishes precise street names from coarse/approximate area names (neighbourhood, LGA, state).
// Gracefully degrades to null when offline or rate-limited.
export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};

    // 1. Precise street or thoroughfare
    const street =
      a.road ||
      a.pedestrian ||
      a.footway ||
      a.street ||
      a.cycleway ||
      a.path ||
      a.highway ||
      null;

    // 2. Locality: neighbourhood, suburb, village, town, or city
    const locality =
      a.neighbourhood ||
      a.suburb ||
      a.residential ||
      a.village ||
      a.hamlet ||
      a.town ||
      a.city ||
      a.city_district ||
      null;

    // 3. LGA / County / District
    const lga =
      a.county ||
      a.state_district ||
      a.municipality ||
      null;

    // 4. State
    const state = a.state || null;

    let displayName = null;
    let shortName = null;
    let approximateName = null;

    if (street) {
      const secondary = locality || lga || state;
      displayName = secondary ? `${street}, ${secondary}` : street;
      shortName = street;
    } else {
      displayName = [locality, lga || state].filter(Boolean).join(', ') || state || null;
      shortName = locality || lga || state || null;
    }

    approximateName = [locality, lga || state].filter(Boolean).join(', ') || state || null;

    return {
      street: street ? street.slice(0, 60) : null,
      locality: locality ? locality.slice(0, 50) : null,
      lga: lga ? lga.slice(0, 50) : null,
      state: state ? state.slice(0, 40) : null,
      displayName: displayName ? displayName.slice(0, 80) : null,
      shortName: shortName ? shortName.slice(0, 45) : null,
      approximateName: approximateName ? approximateName.slice(0, 70) : null,
      isPrecise: Boolean(street),
    };
  } catch {
    return null;
  }
}

// Normalizes Geolocation errors into clear, actionable advice.
export function formatLocationError(err) {
  if (err?.code === 'UNSUPPORTED') {
    return 'Location is not supported by this browser. Use a modern browser over HTTPS.';
  }
  const code = err?.code;
  if (code === 1 || code === window?.GeolocationPositionError?.PERMISSION_DENIED) {
    return 'Location permission is blocked for this site. Allow it in the address bar settings, then tap retry.';
  }
  if (code === 3 || code === window?.GeolocationPositionError?.TIMEOUT) {
    return 'Getting a location fix timed out. Move outdoors or ensure device location is turned on, then tap retry.';
  }
  return 'Your device could not provide a location. Check that location services are turned on, then tap retry.';
}

// Obtains the device position.
// First tries high-accuracy GPS (satellites) with highAccuracyTimeout (default 7s).
// If high-accuracy times out or is unavailable (common indoors or on laptops),
// automatically falls back to coarse accuracy (Wi-Fi/cellular) before failing.
export function getLocation({ highAccuracyTimeout = 7000, coarseTimeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !navigator?.geolocation) {
      const err = new Error('Location is not supported by this browser. Use a modern browser over HTTPS.');
      err.code = 'UNSUPPORTED';
      return reject(err);
    }

    let settled = false;

    const tryCoarse = () => {
      if (settled) return;
      const coarseTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          const timeoutErr = new Error('Location request timed out');
          timeoutErr.code = 3;
          reject(timeoutErr);
        }
      }, coarseTimeout + 1500);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (settled) return;
          settled = true;
          clearTimeout(coarseTimer);
          resolve(pos);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(coarseTimer);
          reject(err);
        },
        { enableHighAccuracy: false, timeout: coarseTimeout, maximumAge: 60000 }
      );
    };

    const highTimer = setTimeout(() => {
      // If high accuracy hasn't responded, fall back to coarse
      tryCoarse();
    }, highAccuracyTimeout + 1000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(highTimer);
        resolve(pos);
      },
      (err) => {
        clearTimeout(highTimer);
        if (settled) return;
        // User denied permission: do not attempt coarse fallback
        if (err?.code === 1 || err?.code === window?.GeolocationPositionError?.PERMISSION_DENIED) {
          settled = true;
          return reject(err);
        }
        // Timed out or unavailable (e.g. laptop/indoor): try coarse immediately
        tryCoarse();
      },
      { enableHighAccuracy: true, timeout: highAccuracyTimeout, maximumAge: 30000 }
    );
  });
}
