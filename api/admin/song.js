import { isAuthenticated } from '../_lib/auth.js';
import { error, json } from '../_lib/http.js';
import { deleteSongBlob, readLibrary, writeLibrary } from '../_lib/library.js';

export async function DELETE(request) {
  if (!isAuthenticated(request)) {
    return error('未授权。', 401);
  }

  try {
    const url = new URL(request.url);
    const songId = url.searchParams.get('id');

    if (!songId) {
      return error('缺少歌曲 ID。', 400);
    }

    const songs = await readLibrary();
    const song = songs.find((item) => item.id === songId);
    if (!song) {
      return error('歌曲不存在。', 404);
    }

    await deleteSongBlob(song);
    await writeLibrary(songs.filter((item) => item.id !== songId));

    return json({ ok: true });
  } catch (reason) {
    return error('删除歌曲失败。', 500, {
      detail: reason instanceof Error ? reason.message : String(reason)
    });
  }
}
