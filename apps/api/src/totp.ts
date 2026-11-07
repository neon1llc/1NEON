// apps/api/src/totp.ts - Authenticator app codes (TOTP, RFC 6238) checked by the API itself, because
// Cognito asks for them only after a password, and 1NEON signs in without one. Built on otpauth (MIT).


import * as OTPAuth from "otpauth";
import QRCode from "qrcode";


// Six digits every 30 seconds, the setting every authenticator app supports
const base = { issuer: "neon1", algorithm: "SHA1", digits: 6, period: 30 } as const;


/** A new secret, the link apps import, and the same link as a QR code image */
export async function newTotp(label: string) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const uri = new OTPAuth.TOTP({ ...base, label, secret }).toString();
  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(await QRCode.toString(uri, { type: "svg", margin: 1 }))}`;
  return { secret: secret.base32, uri, qr };
}


/** The time step a code belongs to (one step either side allowed for clock drift), or undefined */
export function checkTotp(secretBase32: string, code: string, now = Date.now()): number | undefined {
  const totp = new OTPAuth.TOTP({ ...base, secret: OTPAuth.Secret.fromBase32(secretBase32) });
  const delta = totp.validate({ token: code.replace(/\D/g, ""), window: 1, timestamp: now });
  return delta === null ? undefined : Math.floor(now / 1000 / base.period) + delta;
}
