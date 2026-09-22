// Numeric validation for every election-result figure.
// A result sheet is digits only: whole, non-negative integers. Letters,
// symbols, decimals and negatives are rejected BEFORE state is committed, so
// the same rule the server enforces (see validateSubmission.js) is mirrored
// on the client for instant feedback.

export const DIGITS_ONLY = /^[0-9]+$/;

// Sanitizes raw input to plain digits — typing 'e', '-', '.' or pasting
// "1,200" degrades to what the sheet actually shows. Empty input returns ''.
export function sanitizeVotes(raw) {
  if (raw == null) return '';
  return String(raw).replace(/[^0-9]/g, '');
}

// Strict validator: true only for whole, non-negative integers (or '').
// Returns a human message instead of `true` when the value is invalid.
export function validateVotesInput(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') return true;
  if (!DIGITS_ONLY.test(value)) {
    return 'Numbers only — letters and symbols are not allowed';
  }
  return true;
}

// Enforcement used at submit time: malformed values are dropped (never sent
// to the API — a digit-only guarantee) and the caller is told how many were
// removed. Clean digit strings pass through untouched, empty counts as 0.
export function sanitizeVotesMap(partyVotes) {
  const clean = {};
  let dropped = 0;
  for (const [key, raw] of Object.entries(partyVotes || {})) {
    const value = String(raw ?? '');
    if (value === '') continue; // absent parties count as 0
    if (!DIGITS_ONLY.test(value)) {
      dropped += 1; // letters/symbols/decimals — reject, don't coerce
      continue;
    }
    clean[key] = value;
  }
  return { clean, dropped };
}