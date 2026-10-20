import {
  createHmac,
  randomUUID,
  timingSafeEqual,
  createHash,
} from "node:crypto";
const lifetime = 30 * 86400;
function mac(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Session configuration missing");
  return createHmac("sha256", secret).update(value).digest("hex");
}
export function secureEqual(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function issueSession() {
  const id = randomUUID();
  const body = `${id}.${Math.floor(Date.now() / 1000) + lifetime}`;
  return `${body}.${mac(body)}`;
}
export function sessionOwner(cookie?: string) {
  if (!cookie || cookie.length > 160) return null;
  const [id, expires, sig, ...rest] = cookie.split(".");
  if (
    rest.length ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !/^\d+$/.test(expires) ||
    !sig ||
    Number(expires) < Date.now() / 1000
  )
    return null;
  try {
    return secureEqual(sig, mac(`${id}.${expires}`)) ? id : null;
  } catch {
    return null;
  }
}
export function configured() {
  return !!(
    process.env.DATABASE_URL &&
    process.env.VIBETOKEN_API_KEY &&
    process.env.APP_URL &&
    process.env.DEMO_ACCESS_CODE &&
    process.env.DEMO_ACCESS_CODE.length >= 12 &&
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length >= 32
  );
}
