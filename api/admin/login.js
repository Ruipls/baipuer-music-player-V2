import { createSessionCookie, verifyPassword } from '../_lib/auth.js';
import { error, json } from '../_lib/http.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const password = String(body?.password || '');

    if (!password || !verifyPassword(password)) {
      return error('密码不正确。', 401);
    }

    return json(
      { ok: true },
      {
        headers: {
          'Set-Cookie': createSessionCookie(request)
        }
      }
    );
  } catch (reason) {
    return error('登录失败。', 500, {
      detail: reason instanceof Error ? reason.message : String(reason)
    });
  }
}
