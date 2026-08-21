import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export function generateOtp() {
  // 6-digit numeric OTP
  return crypto.randomInt(100000, 999999).toString();
}

export async function hashOtp(code) {
  return bcrypt.hash(code, 10);
}

export async function verifyOtpHash(code, hash) {
  return bcrypt.compare(code, hash);
}

// Placeholder — wire up to an SMS/email provider (e.g. Termii/Twilio for SMS,
// SES/SendGrid for email) before production use.
export async function deliverOtp({ destination, code, channel }) {
  console.log(`[OTP] would send ${code} to ${destination} via ${channel}`);
  return true;
}
