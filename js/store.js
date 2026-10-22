// Réglages et progression de lecture, gardés dans la TV (localStorage).
const SETTINGS_KEY = "jwtv.settings.v1";
const PROGRESS_KEY = "jwtv.progress.v1";
const MAX_PROGRESS = 60;

function read(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : l'app fonctionne sans mémoire */
  }
}

export const settings = { quality: 720, subtitles: false, rate: 1, ...read(SETTINGS_KEY, {}) };

export function saveSettings() {
  write(SETTINGS_KEY, settings);
}

export function progressOf(key) {
  return read(PROGRESS_KEY, {})[key] || null;
}

function summary(v) {
  const { key, title, description, duration, durationText, published, category, primaryCategory, card, wide, cards, wides, files, subtitles } = v;
  return { key, title, description, duration, durationText, published, category, primaryCategory, card, wide, cards, wides, files, subtitles };
}

export function saveProgress(video, time, duration) {
  if (!video || !duration || !Number.isFinite(duration)) return;
  const all = read(PROGRESS_KEY, {});
  const done = time / duration > 0.95 || duration - time < 20;
  all[video.key] = { t: done ? 0 : Math.floor(time), d: Math.floor(duration), done, at: Date.now(), video: summary(video) };
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  for (const key of keys.slice(MAX_PROGRESS)) delete all[key];
  write(PROGRESS_KEY, all);
}

export function continueList() {
  return Object.values(read(PROGRESS_KEY, {}))
    .filter((p) => !p.done && p.t >= 15 && p.video)
    .sort((a, b) => b.at - a.at)
    .map((p) => p.video);
}

export function clearProgress() {
  write(PROGRESS_KEY, {});
}
