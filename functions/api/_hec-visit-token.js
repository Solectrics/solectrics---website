// A short-lived, tamper-evident link lets a customer request a visit on an
// existing HEC enquiry without exposing answers or creating another job.
// The existing Cloudflare Turnstile secret is used with a distinct HMAC
// domain prefix. Rotating that secret invalidates previously emailed links.
const encoder = new TextEncoder();
const TTL = 14 * 24 * 60 * 60;

async function signingKey(env) {
  if (!env?.HEC_TURNSTILE_SECRET) throw new Error("Booking verification is unavailable");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode("solectrics:hec-visit:v1:" + env.HEC_TURNSTILE_SECRET),
    {name:"HMAC",hash:"SHA-256"},
    false,
    ["sign","verify"]
  );
}

export async function createVisitToken(env, enquiryId) {
  const id = Number(enquiryId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid enquiry reference");
  const expires = Math.floor(Date.now() / 1000) + TTL;
  const message = id + "." + expires;
  const signature = await crypto.subtle.sign("HMAC",await signingKey(env),encoder.encode(message));
  const hex = [...new Uint8Array(signature)].map(b=>b.toString(16).padStart(2,"0")).join("");
  return message + "." + hex;
}

export async function verifyVisitToken(env, token) {
  if (typeof token !== "string") return null;
  const match = /^([1-9][0-9]{0,14})\.([0-9]{10})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const id = Number(match[1]);
  const expires = Number(match[2]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(id) || expires < now || expires > now + TTL) return null;
  const bytes = new Uint8Array(match[3].match(/../g).map(hex=>parseInt(hex,16)));
  const valid = await crypto.subtle.verify(
    "HMAC",await signingKey(env),bytes,encoder.encode(match[1] + "." + match[2])
  );
  return valid ? id : null;
}
