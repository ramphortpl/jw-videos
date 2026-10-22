// Outils d'interface partagés : création d'éléments, formats, image de fond, messages.
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "html") el.innerHTML = value;
    else if (key === "style") el.style.cssText = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Action déclenchée par OK (ou un clic) sur un élément navigable.
const actions = new WeakMap();
export function onSelect(el, action) {
  actions.set(el, action);
  return el;
}
export function select(el) {
  const action = el && actions.get(el);
  if (action) action();
  return Boolean(action);
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 4.9v14.2a1 1 0 0 0 1.52.85l11.4-7.1a1 1 0 0 0 0-1.7L8.52 4.05A1 1 0 0 0 7 4.9z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect fill="currentColor" x="6" y="4.5" width="4.3" height="15" rx="1.2"/><rect fill="currentColor" x="13.7" y="4.5" width="4.3" height="15" rx="1.2"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  cc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6"/></svg>',
};
export function icon(name) {
  return h("span", { class: "icon", html: ICONS[name] || "" });
}

const pad = (n) => String(n).padStart(2, "0");

export function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, hrs = Math.floor(seconds / 3600);
  return hrs ? `${hrs}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function humanDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return `${Math.max(1, Math.round(seconds))} s`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)}`;
}

export function frenchDate(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Scène dessinée en 1920 x 1080, mise à l'échelle de l'écran (sans effet sur une TV 1080p).
export function fitStage(stage) {
  const fit = () => {
    const w = window.innerWidth || DESIGN_W, hgt = window.innerHeight || DESIGN_H;
    const scale = Math.min(w / DESIGN_W, hgt / DESIGN_H);
    stage.style.transform = `scale(${scale})`;
    stage.style.left = `${Math.round((w - DESIGN_W * scale) / 2)}px`;
    stage.style.top = `${Math.round((hgt - DESIGN_H * scale) / 2)}px`;
  };
  window.addEventListener("resize", fit);
  document.addEventListener("visibilitychange", fit);
  fit();
  setTimeout(fit, 600);  // certaines fenêtres n'ont leur taille qu'après le chargement
}

export function startClock(el) {
  const tick = () => {
    const now = new Date();
    el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  };
  tick();
  setInterval(tick, 10000);
}

// Image de fond en fondu enchaîné ; l'image est décodée avant d'apparaître.
// `urls` : une adresse ou une liste de secours (essayées dans l'ordre).
export const backdrop = (() => {
  let layers = [], front = 0, wanted = "", timer = null;
  function apply(urls, token) {
    const [url, ...rest] = urls;
    const img = new Image();
    img.onload = () => {
      if (wanted !== token) return;
      const next = layers[1 - front];
      next.style.backgroundImage = `url("${url}")`;
      next.classList.add("is-visible");
      layers[front].classList.remove("is-visible");
      front = 1 - front;
    };
    img.onerror = () => {
      if (wanted === token && rest.length) apply(rest, token);
    };
    img.src = url;
  }
  return {
    init(root) { layers = Array.from(root.querySelectorAll(".backdrop-layer")); },
    set(urls, delay = 220) {
      const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
      if (!list.length || list[0] === wanted) return;
      wanted = list[0];
      clearTimeout(timer);
      timer = setTimeout(() => apply(list, list[0]), delay);
    },
  };
})();

let toastTimer = null;
export function toast(text, duration = 3200) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.remove("is-hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("is-hidden"), duration);
}
