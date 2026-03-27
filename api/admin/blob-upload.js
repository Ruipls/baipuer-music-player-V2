import { handleUpload } from '@vercel/blob/client';
import { isAuthenticated } from '../_lib/auth.js';
import { error, json } from '../_lib/http.js';
import {
  ALLOWED_CONTENT_TYPES,
  MAX_SONGS,
  MAX_UPLOAD_BYTES,
  buildAccentHue,
  buildBlobPath,
  deleteSongBlob,
  isAllowedAudioFile,
  readLibrary,
  writeLibrary
} from '../_lib/library.js';

function parseClientPayload(value) {
  const payload = typeof value === 'string' ? JSON.parse(value) : value;

  const title = String(payload?.title || '').trim();
  const artist = String(payload?.artist || '').trim();
  const album = String(payload?.album || '').trim();
  const note = String(payload?.note || '').trim();
  const fileName = String(payload?.fileName || '').trim();
  const songId = String(payload?.songId || '').trim();

  if (!title) {
    throw new Error('歌曲标题不能为空。');
  }

  if (!songId) {
    throw new Error('缺少歌曲 ID。');
  }

  if (!fileName || !isAllowedAudioFile(fileName)) {
    throw new Error('仅支持 MP3、WAV、OGG、M4A、AAC 和 FLAC 文件。');
  }

  return {
    songId,
    title,
    artist,
    album,
    note,
    fileName
  };
}

export async function POST(request) {
  try {
    const jsonResponse = await handleUpload({
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!isAuthenticated(request)) {
          throw new Error('未授权。');
        }

        const songs = await readLibrary();
        if (songs.length >= MAX_SONGS) {
          throw new Error(`当前最多只保留 ${MAX_SONGS} 首歌，请先删除旧歌曲。`);
        }

        const parsedPayload = parseClientPayload(clientPayload);
        const expectedPath = buildBlobPath(parsedPayload.songId, parsedPayload.fileName);

        if (pathname !== expectedPath) {
          throw new Error('上传路径无效。');
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          allowOverwrite: false,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify(parsedPayload)
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const parsedPayload = parseClientPayload(tokenPayload);
        const songs = await readLibrary();

        if (songs.some((item) => item.id === parsedPayload.songId)) {
          return;
        }

        if (songs.length >= MAX_SONGS) {
          await deleteSongBlob({ blobPath: blob.pathname });
          return;
        }

        const song = {
          id: parsedPayload.songId,
          title: parsedPayload.title,
          artist: parsedPayload.artist,
          album: parsedPayload.album,
          note: parsedPayload.note,
          fileName: parsedPayload.fileName,
          mimeType: blob.contentType || '',
          size: blob.size || 0,
          uploadedAt: new Date(blob.uploadedAt || Date.now()).toISOString(),
          accentHue: buildAccentHue(`${parsedPayload.title}|${parsedPayload.artist}|${parsedPayload.album}`),
          blobPath: blob.pathname,
          streamUrl: blob.url
        };

        await writeLibrary([...songs, song]);
      }
    });

    return json(jsonResponse);
  } catch (reason) {
    return error('生成上传授权失败。', 400, {
      detail: reason instanceof Error ? reason.message : String(reason)
    });
  }
}
