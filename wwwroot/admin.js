import { upload } from 'https://esm.sh/@vercel/blob@1.1.1/client?bundle';

const authCard = document.getElementById('authCard');
const adminWorkspace = document.getElementById('adminWorkspace');
const loginForm = document.getElementById('loginForm');
const passwordInput = document.getElementById('passwordInput');
const loginButton = document.getElementById('loginButton');
const authStatus = document.getElementById('authStatus');
const uploadForm = document.getElementById('uploadForm');
const titleInput = document.getElementById('titleInput');
const artistInput = document.getElementById('artistInput');
const albumInput = document.getElementById('albumInput');
const noteInput = document.getElementById('noteInput');
const fileInput = document.getElementById('fileInput');
const fileNameHint = document.getElementById('fileNameHint');
const submitButton = document.getElementById('submitButton');
const statusText = document.getElementById('statusText');
const libraryList = document.getElementById('libraryList');
const libraryEmpty = document.getElementById('libraryEmpty');
const libraryCount = document.getElementById('libraryCount');
const slotsInfo = document.getElementById('slotsInfo');
const logoutButton = document.getElementById('logoutButton');

const state = {
  songs: [],
  authenticated: false
};
const isLocalPreview = window.location.protocol === 'http:';

function setMessage(element, message, tone = 'neutral') {
  element.textContent = message;
  element.classList.remove('is-error', 'is-success');
  if (tone === 'error') {
    element.classList.add('is-error');
  }
  if (tone === 'success') {
    element.classList.add('is-success');
  }
}

function formatFileSize(size) {
  if (!Number.isFinite(size)) {
    return '--';
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(input) {
  if (!input) {
    return '刚刚上传';
  }

  const date = new Date(input);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function generateSongId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 12);
}

function getExtension(fileName) {
  const normalized = String(fileName || '').toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  return dotIndex >= 0 ? normalized.slice(dotIndex) : '';
}

function buildBlobPath(songId, fileName) {
  const extension = getExtension(fileName);
  const baseName = String(fileName || '')
    .slice(0, Math.max(0, fileName.length - extension.length))
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'track';

  return `tracks/${songId}-${baseName}${extension}`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('文件读取失败。'));
    reader.readAsDataURL(file);
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : null;

  if (!response.ok) {
    throw new Error(payload?.error || payload?.detail || '请求失败。');
  }

  return payload;
}

function updateCapacity() {
  const remaining = Math.max(0, 5 - state.songs.length);
  libraryCount.textContent = `${state.songs.length} / 5`;
  slotsInfo.textContent = `剩余 ${remaining} 个位置`;
}

function applyAuthState() {
  authCard.classList.toggle('hidden', state.authenticated);
  adminWorkspace.classList.toggle('hidden', !state.authenticated);
}

function renderLibrary() {
  libraryList.innerHTML = '';
  libraryEmpty.classList.toggle('hidden', state.songs.length > 0);
  updateCapacity();

  for (const song of state.songs) {
    const item = document.createElement('article');
    item.className = 'library-item';
    item.innerHTML = `
      <div class="library-summary">
        <strong>${song.title || '未命名歌曲'}</strong>
        <div class="library-meta">
          <span>${song.artist || '未填写歌手'}${song.album ? ` / ${song.album}` : ''}</span>
          <span>${formatFileSize(song.size)} / ${formatDate(song.uploadedAt)}</span>
        </div>
        <div class="track-subline">
          <span>${song.note || '无附加说明'}</span>
          <span>${song.fileName || ''}</span>
        </div>
      </div>
      <div class="library-actions">
        <button class="danger-button" type="button" data-song-id="${song.id}">删除</button>
      </div>
    `;
    libraryList.appendChild(item);
  }
}

async function fetchSongs() {
  const songs = await requestJson('/api/songs', {
    cache: 'no-store'
  });

  state.songs = Array.isArray(songs) ? songs : [];
  renderLibrary();
}

async function refreshSession() {
  try {
    const session = await requestJson('/api/admin/session', {
      cache: 'no-store'
    });

    state.authenticated = Boolean(session?.authenticated);
    applyAuthState();

    await fetchSongs();

    if (state.authenticated) {
      setMessage(statusText, '后台已就绪，你现在可以管理现场曲目。', 'success');
    }
  } catch (reason) {
    applyAuthState();
    setMessage(authStatus, reason instanceof Error ? reason.message : '无法确认登录状态。', 'error');
  }
}

async function waitForSongSync(songId) {
  for (let index = 0; index < 12; index += 1) {
    await fetchSongs();
    if (state.songs.some((song) => song.id === songId)) {
      return true;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 700);
    });
  }

  return false;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  loginButton.disabled = true;
  setMessage(authStatus, '正在验证管理员身份...');

  try {
    await requestJson('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        password: passwordInput.value
      })
    });

    passwordInput.value = '';
    state.authenticated = true;
    applyAuthState();
    await fetchSongs();
    setMessage(statusText, '登录成功，后台已解锁。', 'success');
  } catch (reason) {
    setMessage(authStatus, reason instanceof Error ? reason.message : '登录失败。', 'error');
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;

  try {
    await requestJson('/api/admin/logout', {
      method: 'POST'
    });

    state.authenticated = false;
    applyAuthState();
    setMessage(authStatus, '已退出登录。', 'success');
    passwordInput.focus();
  } catch (reason) {
    setMessage(statusText, reason instanceof Error ? reason.message : '退出登录失败。', 'error');
  } finally {
    logoutButton.disabled = false;
  }
});

fileInput.addEventListener('change', () => {
  const [file] = fileInput.files || [];
  fileNameHint.textContent = file ? `${file.name} / ${formatFileSize(file.size)}` : '尚未选择文件';
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!state.authenticated) {
    setMessage(authStatus, '请先登录后台。', 'error');
    return;
  }

  if (state.songs.length >= 5) {
    setMessage(statusText, '曲库已满，请先删除旧歌曲。', 'error');
    return;
  }

  const [file] = fileInput.files || [];
  if (!file) {
    setMessage(statusText, '请先选择一个音频文件。', 'error');
    return;
  }

  const songId = generateSongId();
  const pathname = buildBlobPath(songId, file.name);

  submitButton.disabled = true;
  setMessage(statusText, '正在上传音频并同步现场歌单，请稍候。');

  try {
    if (isLocalPreview) {
      await requestJson('/api/admin/upload', {
        method: 'POST',
        body: JSON.stringify({
          title: titleInput.value.trim(),
          artist: artistInput.value.trim(),
          album: albumInput.value.trim(),
          note: noteInput.value.trim(),
          fileName: file.name,
          mimeType: file.type,
          contentBase64: await readFileAsBase64(file)
        })
      });
    } else {
      await upload(pathname, file, {
        access: 'public',
        handleUploadUrl: '/api/admin/blob-upload',
        clientPayload: JSON.stringify({
          songId,
          title: titleInput.value.trim(),
          artist: artistInput.value.trim(),
          album: albumInput.value.trim(),
          note: noteInput.value.trim(),
          fileName: file.name
        })
      });
    }

    const synced = isLocalPreview ? (await fetchSongs(), true) : await waitForSongSync(songId);
    uploadForm.reset();
    fileNameHint.textContent = '尚未选择文件';

    if (synced) {
      setMessage(statusText, '上传成功，前台现场页面已经更新。', 'success');
    } else {
      setMessage(statusText, '音频已上传，但歌单同步稍慢，请稍后刷新后台确认。', 'error');
    }
  } catch (reason) {
    setMessage(statusText, reason instanceof Error ? reason.message : '上传失败，请稍后重试。', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

libraryList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-song-id]');
  if (!button) {
    return;
  }

  const songId = button.dataset.songId;
  if (!songId) {
    return;
  }

  if (!window.confirm('确定要从现场歌单中删除这首歌吗？')) {
    return;
  }

  button.disabled = true;
  setMessage(statusText, '正在删除歌曲...');

  try {
    const deleteUrl = isLocalPreview
      ? `/api/admin/song/${encodeURIComponent(songId)}`
      : `/api/admin/song?id=${encodeURIComponent(songId)}`;

    await requestJson(deleteUrl, {
      method: 'DELETE'
    });
    await fetchSongs();
    setMessage(statusText, '歌曲已删除，前台会立即反映新的曲库。', 'success');
  } catch (reason) {
    setMessage(statusText, reason instanceof Error ? reason.message : '删除失败，请稍后重试。', 'error');
  } finally {
    button.disabled = false;
  }
});

refreshSession();
