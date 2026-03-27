const audio = document.getElementById('audioPlayer');
const playButton = document.getElementById('playButton');
const prevButton = document.getElementById('prevButton');
const nextButton = document.getElementById('nextButton');
const shuffleButton = document.getElementById('shuffleButton');
const repeatButton = document.getElementById('repeatButton');
const repeatBadge = document.getElementById('repeatBadge');
const muteButton = document.getElementById('muteButton');
const progressRange = document.getElementById('progressRange');
const volumeRange = document.getElementById('volumeRange');
const speedSelect = document.getElementById('speedSelect');
const trackTitle = document.getElementById('trackTitle');
const trackMeta = document.getElementById('trackMeta');
const currentTime = document.getElementById('currentTime');
const totalTime = document.getElementById('totalTime');
const playlist = document.getElementById('playlist');
const emptyState = document.getElementById('emptyState');
const songCount = document.getElementById('songCount');

const repeatModes = ['off', 'all', 'one'];
const state = {
  songs: [],
  currentIndex: -1,
  isPlaying: false,
  isShuffle: false,
  repeatMode: 'off',
  manualSeeking: false,
  durationCache: new Map()
};

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }

  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function setAccent(hue = 22) {
  document.documentElement.style.setProperty('--accent', `hsl(${hue} 72% 45%)`);
  document.documentElement.style.setProperty('--accent-soft', `hsl(${(hue + 22) % 360} 70% 84%)`);
  document.documentElement.style.setProperty('--accent-deep', `hsl(${hue} 82% 32%)`);
}

function updateRepeatUi() {
  const labelMap = {
    off: '循环关闭',
    all: '列表循环',
    one: '单曲循环'
  };

  const label = labelMap[state.repeatMode];
  repeatBadge.textContent = label;
  repeatButton.textContent = `循环 ${label.replace('循环', '').trim() || '关闭'}`;
  repeatButton.classList.toggle('active', state.repeatMode !== 'off');
}

function updatePlayUi() {
  document.body.classList.toggle('is-playing', state.isPlaying);
  playButton.textContent = state.isPlaying ? '暂停' : '播放';
}

function getCurrentSong() {
  return state.songs[state.currentIndex] || null;
}

function renderPlaylist() {
  playlist.innerHTML = '';
  songCount.textContent = `${state.songs.length} 首`;
  emptyState.classList.toggle('hidden', state.songs.length > 0);

  state.songs.forEach((song, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'playlist-item';
    if (index === state.currentIndex) {
      item.classList.add('active');
    }

    const duration = state.durationCache.get(song.id);
    item.innerHTML = `
      <div class="track-line">
        <strong>${song.title || '未命名歌曲'}</strong>
        <span>${duration ? formatTime(duration) : '待加载'}</span>
      </div>
      <div class="track-subline">
        <span>${song.artist || '未填写歌手'}${song.album ? ` / ${song.album}` : ''}</span>
        <span>${song.note || '点击即可切换播放'}</span>
      </div>
    `;

    item.addEventListener('click', () => {
      loadSong(index, true);
    });

    playlist.appendChild(item);
  });
}

function updateTrackPanel() {
  const song = getCurrentSong();
  if (!song) {
    trackTitle.textContent = '等待加载曲目';
    trackMeta.textContent = '本场曲目加载完成后，这里会显示标题、歌手和当前氛围。';
    currentTime.textContent = '00:00';
    totalTime.textContent = '00:00';
    progressRange.value = '0';
    setAccent(22);
    return;
  }

  trackTitle.textContent = song.title || '未命名歌曲';
  const metaParts = [];
  if (song.artist) metaParts.push(song.artist);
  if (song.album) metaParts.push(song.album);
  const fallback = song.note || '已准备就绪，点击播放开始聆听。';
  trackMeta.textContent = metaParts.length ? `${metaParts.join(' / ')} / ${fallback}` : fallback;
  setAccent(song.accentHue || 22);
}

function loadSong(index, autoplay = false) {
  if (!state.songs.length) {
    return;
  }

  state.currentIndex = index;
  const song = getCurrentSong();
  audio.src = song.streamUrl;
  audio.playbackRate = Number(speedSelect.value);
  updateTrackPanel();
  renderPlaylist();

  if (autoplay) {
    audio.play().then(() => {
      state.isPlaying = true;
      updatePlayUi();
    }).catch(() => {
      state.isPlaying = false;
      updatePlayUi();
    });
  } else {
    state.isPlaying = false;
    updatePlayUi();
  }
}

function pickNextIndex(direction = 1) {
  if (!state.songs.length) {
    return -1;
  }

  if (state.isShuffle && state.songs.length > 1) {
    let next = state.currentIndex;
    while (next === state.currentIndex) {
      next = Math.floor(Math.random() * state.songs.length);
    }
    return next;
  }

  const nextIndex = state.currentIndex + direction;
  if (nextIndex < 0) {
    return state.repeatMode === 'all' ? state.songs.length - 1 : 0;
  }

  if (nextIndex >= state.songs.length) {
    return state.repeatMode === 'all' ? 0 : state.songs.length - 1;
  }

  return nextIndex;
}

async function fetchSongs() {
  const response = await fetch('/api/songs');
  if (!response.ok) {
    throw new Error('无法加载歌曲列表');
  }

  state.songs = await response.json();
  if (state.songs.length) {
    loadSong(0, false);
  } else {
    renderPlaylist();
    updateTrackPanel();
  }

  probeDurations();
}

function probeDurations() {
  state.songs.forEach((song) => {
    if (state.durationCache.has(song.id)) {
      return;
    }

    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.src = song.streamUrl;
    probe.addEventListener('loadedmetadata', () => {
      state.durationCache.set(song.id, probe.duration);
      renderPlaylist();
    }, { once: true });
  });
}

playButton.addEventListener('click', async () => {
  if (!state.songs.length) {
    return;
  }

  if (!audio.src) {
    loadSong(0, true);
    return;
  }

  if (audio.paused) {
    await audio.play();
  } else {
    audio.pause();
  }
});

prevButton.addEventListener('click', () => {
  if (!state.songs.length) {
    return;
  }

  loadSong(pickNextIndex(-1), true);
});

nextButton.addEventListener('click', () => {
  if (!state.songs.length) {
    return;
  }

  loadSong(pickNextIndex(1), true);
});

shuffleButton.addEventListener('click', () => {
  state.isShuffle = !state.isShuffle;
  shuffleButton.classList.toggle('active', state.isShuffle);
});

repeatButton.addEventListener('click', () => {
  const currentIndex = repeatModes.indexOf(state.repeatMode);
  state.repeatMode = repeatModes[(currentIndex + 1) % repeatModes.length];
  updateRepeatUi();
});

muteButton.addEventListener('click', () => {
  audio.muted = !audio.muted;
  muteButton.classList.toggle('active', audio.muted);
  muteButton.textContent = audio.muted ? '取消静音' : '静音';
});

progressRange.addEventListener('input', () => {
  state.manualSeeking = true;
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const nextTime = duration * (Number(progressRange.value) / 100);
  currentTime.textContent = formatTime(nextTime);
});

progressRange.addEventListener('change', () => {
  if (!Number.isFinite(audio.duration)) {
    state.manualSeeking = false;
    return;
  }

  audio.currentTime = audio.duration * (Number(progressRange.value) / 100);
  state.manualSeeking = false;
});

volumeRange.addEventListener('input', () => {
  audio.volume = Number(volumeRange.value) / 100;
  if (audio.volume > 0) {
    audio.muted = false;
    muteButton.classList.remove('active');
    muteButton.textContent = '静音';
  }
});

speedSelect.addEventListener('change', () => {
  audio.playbackRate = Number(speedSelect.value);
});

audio.addEventListener('play', () => {
  state.isPlaying = true;
  updatePlayUi();
});

audio.addEventListener('pause', () => {
  state.isPlaying = false;
  updatePlayUi();
});

audio.addEventListener('loadedmetadata', () => {
  totalTime.textContent = formatTime(audio.duration);
  const song = getCurrentSong();
  if (song) {
    state.durationCache.set(song.id, audio.duration);
    renderPlaylist();
  }
});

audio.addEventListener('timeupdate', () => {
  if (!state.manualSeeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    progressRange.value = String((audio.currentTime / audio.duration) * 100);
    currentTime.textContent = formatTime(audio.currentTime);
  }
});

audio.addEventListener('ended', () => {
  if (state.repeatMode === 'one') {
    audio.currentTime = 0;
    audio.play();
    return;
  }

  const isLastSong = state.currentIndex >= state.songs.length - 1;
  if (!state.isShuffle && state.repeatMode === 'off' && isLastSong) {
    state.isPlaying = false;
    updatePlayUi();
    return;
  }

  loadSong(pickNextIndex(1), true);
});

document.addEventListener('keydown', (event) => {
  const activeTag = document.activeElement?.tagName;
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') {
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();
    playButton.click();
  }

  if (event.code === 'ArrowRight') {
    audio.currentTime = Math.min((audio.duration || 0), audio.currentTime + 10);
  }

  if (event.code === 'ArrowLeft') {
    audio.currentTime = Math.max(0, audio.currentTime - 10);
  }
});

updateRepeatUi();
audio.volume = Number(volumeRange.value) / 100;
fetchSongs().catch(() => {
  emptyState.classList.remove('hidden');
  emptyState.textContent = '本场歌单暂时无法载入，请稍后刷新页面。';
  updateTrackPanel();
});
