import { del, list, put } from '@vercel/blob';

const MANIFEST_PATH = 'manifests/library.json';
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);

export const MAX_SONGS = 5;
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
  'application/octet-stream'
];

function sanitizeNameSegment(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function createBlobConfigError() {
  return new Error('Vercel Blob is not configured for this project yet.');
}

export function getExtension(fileName) {
  const normalized = String(fileName || '').toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
}

export function isAllowedAudioFile(fileName) {
  return ALLOWED_EXTENSIONS.has(getExtension(fileName));
}

export function buildBlobPath(songId, fileName) {
  const extension = getExtension(fileName);
  const baseName = sanitizeNameSegment(fileName.slice(0, Math.max(0, fileName.length - extension.length))) || 'track';
  return `tracks/${songId}-${baseName}${extension}`;
}

export function buildAccentHue(text) {
  let hash = 37;
  for (const character of String(text || '')) {
    hash = ((hash * 31) + character.charCodeAt(0)) % 360;
  }

  return Math.abs(hash);
}

export function sortSongs(songs) {
  return [...songs].sort((left, right) => String(left.uploadedAt).localeCompare(String(right.uploadedAt)));
}

export async function readLibrary() {
  if (!isBlobConfigured()) {
    return [];
  }

  const { blobs } = await list({ prefix: MANIFEST_PATH, limit: 10 });
  const manifest = blobs.find((blob) => blob.pathname === MANIFEST_PATH);

  if (!manifest) {
    return [];
  }

  const response = await fetch(`${manifest.url}?v=${Date.now()}`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error('Failed to read the current library manifest.');
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

export async function writeLibrary(songs) {
  if (!isBlobConfigured()) {
    throw createBlobConfigError();
  }

  await put(MANIFEST_PATH, JSON.stringify(sortSongs(songs), null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: 60
  });
}

export async function deleteSongBlob(song) {
  if (!song?.blobPath) {
    return;
  }

  if (!isBlobConfigured()) {
    throw createBlobConfigError();
  }

  await del(song.blobPath);
}

export function toPublicSong(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    note: song.note,
    fileName: song.fileName,
    mimeType: song.mimeType,
    size: song.size,
    uploadedAt: song.uploadedAt,
    accentHue: song.accentHue,
    streamUrl: song.streamUrl
  };
}
