import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "studypilot_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set.");
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(studentId: string): Promise<string> {
  return new SignJWT({ sub: studentId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/** Verifies a session token, returning the studentId or null — never throws. */
export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export { SESSION_MAX_AGE_SECONDS };
