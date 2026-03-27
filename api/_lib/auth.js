import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'bapuer_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const DEFAULT_ADMIN_PASSWORD = '110';
const DEFAULT_SESSION_SECRET = 'bapuer-session-secret-fallback-2026';

function getSessionSecret() {
  return process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value) {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function parseCookies(headerValue) {
  return (headerValue || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) {
        return cookies;
      }

      const name = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      cookies[name] = value;
      return cookies;
    }, {});
}

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyPassword(password) {
  const expected = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;
  return safeEquals(String(password || ''), expected);
}

export function createSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const payload = base64UrlEncode(JSON.stringify({
    exp: Date.now() + SESSION_TTL_SECONDS * 1000
  }));
  const signature = sign(payload);

  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function isAuthenticated(request) {
  const cookies = parseCookies(request.headers.get('cookie'));
  const token = cookies[SESSION_COOKIE];

  if (!token || !token.includes('.')) {
    return false;
  }

  const [payload, signature] = token.split('.');
  const expectedSignature = sign(payload);
  if (!safeEquals(signature, expectedSignature)) {
    return false;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    return Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}
