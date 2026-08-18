import { useState } from 'react';

// Action Alliance emblem — the party's own logo when /aa-logo.png is placed
// in this app's public/ folder, otherwise an inline green/gold "AA" mark so
// auth screens are never left blank.
export default function AaLogo({ size = 40 }) {
  const [usePhoto, setUsePhoto] = useState(true);

  if (usePhoto) {
    return (
      <img
        src={`/aa-logo.png`}
        alt="Action Alliance"
        width={size}
        height={size}
        style={{ objectFit: 'contain', borderRadius: 6 }}
        onError={() => setUsePhoto(false)}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Action Alliance"
    >
      <rect width="48" height="48" rx="10" fill="var(--aa-green)" />
      <rect x="1.5" y="1.5" width="45" height="45" rx="8.5" stroke="var(--aa-gold)" strokeWidth="3" fill="none" />
      <path d="M24 10 L32 15 V24 C32 29.5 28.7 33.4 24 35 C19.3 33.4 16 29.5 16 24 V15 Z" fill="var(--aa-gold)" />
      <text
        x="24"
        y="27"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight="800"
        fontSize="13"
        fill="var(--aa-green-dark)"
      >
        AA
      </text>
    </svg>
  );
}