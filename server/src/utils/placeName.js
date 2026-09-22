// Server-side reverse geocoding for the submission's capture point.
// Produces the human-readable place (street / landmark / town) that admins
// see on uploaded photos. Nomintatim is free but rate-limited, so we cache
// by rounded coordinates so identical captures don't re-hit the network.
//
// This runs at submission time so the stored place is derived from the GPS
// fix, never from a manually-entered string (the client cannot inject it).

const CACHE = new Map();

function roundKey(lat, lng) {
  // ~100 m resolution — nearby fixes from the same capture point collide.
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

export async function reverseGeocodePlace(lat, lng) {
  const key = roundKey(lat, lng);
  if (CACHE.has(key)) return CACHE.get(key);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18`,
      { headers: { 'User-Agent': 'action-alliance-result-portal/1.0' }, signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};

    const street =
      a.road || a.pedestrian || a.footway || a.street || a.cycleway || a.path || a.highway || null;
    const locality =
      a.neighbourhood || a.suburb || a.residential || a.village || a.hamlet || a.town || a.city_district || a.city || null;
    const lga = a.county || a.state_district || a.municipality || null;
    const state = a.state || null;

    let label = null;
    if (street) {
      label = locality || lga || state ? `${street}, ${locality || lga || state}` : street;
    } else {
      label = [locality, lga, state].filter(Boolean).join(', ') || null;
    }
    const trimmed = label ? label.slice(0, 140) : null;
    CACHE.set(key, trimmed);
    return trimmed;
  } catch {
    return null;
  }
}