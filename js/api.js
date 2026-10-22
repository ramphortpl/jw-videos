// Catalogue vidéo de jw.org via son API publique « mediator » (CORS ouvert).
// Rien n'est copié : l'app lit le catalogue et les vidéos directement sur jw.org.
const BASE = "https://b.jw-cdn.org/apis/mediator/v1";
export const LANG = "F";  // F = français, E = anglais…
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const STORE_PREFIX = "jwtv.cache.v1:";
const memory = new Map();

function readStored(url) {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + url);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(url, entry) {
  try {
    localStorage.setItem(STORE_PREFIX + url, JSON.stringify(entry));
  } catch {
    /* stockage plein ou désactivé : le cache mémoire suffit */
  }
}

async function fetchJSON(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

// `persist` garde la réponse dans le navigateur : démarrage instantané et
// catalogue encore consultable si le réseau est coupé.
async function get(path, { ttl = 30 * MINUTE, persist = false } = {}) {
  const url = `${BASE}/${path}${path.includes("?") ? "&" : "?"}clientType=www`;
  let entry = memory.get(url) || (persist ? readStored(url) : null);
  if (entry && Date.now() - entry.at < ttl) {
    memory.set(url, entry);
    return entry.data;
  }
  try {
    const data = await fetchJSON(url);
    entry = { at: Date.now(), data };
    memory.set(url, entry);
    if (persist) writeStored(url, entry);
    return data;
  } catch (error) {
    if (entry) {
      console.warn("Réseau indisponible : catalogue en cache utilisé", path);
      return entry.data;
    }
    throw error;
  }
}

const CARD_IMAGES = [["wss", "lg"], ["lss", "lg"], ["lsr", "xl"], ["pnr", "lg"], ["wss", "sm"], ["sqr", "lg"]];
const WIDE_IMAGES = [["lsr", "xl"], ["pnr", "lg"], ["lss", "lg"], ["wss", "lg"]];
const BANNER_IMAGES = [["pnr", "lg"], ["wss", "lg"], ["wss", "sm"]];

function pick(images, order) {
  return candidates(images, order)[0] || "";
}

// Toutes les images disponibles, dans l'ordre de préférence : certaines adresses
// annoncées par jw.org répondent 403 (anciennes vidéos), l'app passe alors à la suivante.
function candidates(images, order) {
  const urls = [];
  for (const [type, size] of order) {
    const url = images?.[type]?.[size];
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function toVideo(m, category = "") {
  const files = (m.files || [])
    .filter((f) => f.progressiveDownloadURL && /mp4/.test(f.mimetype || ""))
    .map((f) => ({
      label: f.label || "",
      height: parseInt(f.label, 10) || f.frameHeight || 0,
      url: f.progressiveDownloadURL,
      subtitles: f.subtitles?.url || "",
    }))
    .sort((a, b) => a.height - b.height);
  const cards = candidates(m.images, CARD_IMAGES);
  const wides = candidates(m.images, WIDE_IMAGES);
  return {
    key: m.languageAgnosticNaturalKey || m.naturalKey || m.guid,
    title: m.title || "Sans titre",
    description: m.description || "",
    duration: m.duration || 0,
    durationText: m.durationFormattedHHMM || "",
    published: m.firstPublished || "",
    category,
    primaryCategory: m.primaryCategory || "",
    card: cards[0] || "",
    wide: wides[0] || "",
    cards,
    wides,
    files,
    subtitles: files.find((f) => f.subtitles)?.subtitles || "",
  };
}

function toCategory(c) {
  return { key: c.key, name: c.name || c.key, description: c.description || "", banner: pick(c.images, BANNER_IMAGES) };
}

function rowsOf(category, limit) {
  const rows = [];
  const add = (source) => {
    if (!source.media?.length) return;
    rows.push({
      key: source.key,
      title: source.name,
      items: source.media.map((m) => toVideo(m, source.name)),
      complete: !limit || source.media.length < limit,
    });
  };
  add(category);
  for (const sub of category.subcategories || []) add(sub);
  return rows;
}

// Les 14 grandes catégories (JW Télédiffusion, Enfants, Famille…).
export async function categories() {
  const data = await get(`categories/${LANG}/VideoOnDemand?detailed=1`, { ttl: 6 * HOUR, persist: true });
  return (data.category?.subcategories || []).map(toCategory);
}

// Une catégorie et ses sous-catégories, limitées à `limit` vidéos chacune
// (la suite est chargée à la demande par fullRow).
export async function category(key, limit = 24, persist = false) {
  const data = await get(`categories/${LANG}/${encodeURIComponent(key)}?detailed=1&mediaLimit=${limit}`,
    { ttl: persist ? HOUR : 30 * MINUTE, persist });
  const c = data.category || {};
  return { ...toCategory(c), rows: rowsOf(c, limit) };
}

export async function fullRow(key) {
  const data = await get(`categories/${LANG}/${encodeURIComponent(key)}?detailed=1`);
  const c = data.category || {};
  return (c.media || []).map((m) => toVideo(m, c.name));
}

export async function video(key) {
  const data = await get(`media-items/${LANG}/${encodeURIComponent(key)}`);
  const m = data.media?.[0];
  return m ? toVideo(m) : null;
}

export async function home() {
  const [cats, latest, studio] = await Promise.all([
    categories(),
    category("LatestVideos", 40, true),
    category("VODStudio", 20, true),
  ]);
  const latestItems = latest.rows[0]?.items || [];
  const featuredItems = studio.rows.find((row) => row.key === "StudioFeatured")?.items || [];
  const seen = new Set();
  const featured = [...featuredItems, ...latestItems]
    .filter((v) => !seen.has(v.key) && seen.add(v.key))
    .slice(0, 8);
  return {
    categories: cats,
    featured,
    latest: latestItems,
    studio: studio.rows.filter((row) => row.key !== "StudioFeatured"),
  };
}
