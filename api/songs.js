import { json, error } from './_lib/http.js';
import { readLibrary, toPublicSong } from './_lib/library.js';

export async function GET() {
  try {
    const songs = await readLibrary();
    return json(songs.map(toPublicSong));
  } catch (reason) {
    return error('无法读取当前歌单。', 500, {
      detail: reason instanceof Error ? reason.message : String(reason)
    });
  }
}
