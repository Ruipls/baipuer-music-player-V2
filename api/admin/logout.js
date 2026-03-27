import { clearSessionCookie } from '../_lib/auth.js';
import { json } from '../_lib/http.js';

export async function POST(request) {
  return json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': clearSessionCookie(request)
      }
    }
  );
}
