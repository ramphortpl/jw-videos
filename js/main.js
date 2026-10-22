// JW Vidéos : démarrage, routes, fenêtres (réglages, sortie) et télécommande.
import { FocusManager } from "./focus.js";
import * as api from "./api.js";
import * as store from "./store.js";
import { h, onSelect, select, fitStage, startClock, backdrop, toast } from "./ui.js";
import { HomeView, CategoriesView, CategoryView, DetailView, cardData } from "./views.js";
import { Player } from "./player.js";

const BACK_CODES = new Set([8, 27, 461, 10009]);  // Retour = 8 sur VIDAA
const PLAY_CODES = new Set([415, 463, 179]);
const ARROWS = { 37: "left", 38: "up", 39: "right", 40: "down" };
const MAX_CATEGORY_VIEWS = 6;

const stage = document.getElementById("stage");
const viewsRoot = document.getElementById("views");
const focus = new FocusManager();

// ---------- Fenêtre modale (réglages, quitter) ----------

const modal = {
  el: h("div", { class: "modal is-hidden" }),
  open: false,
  show(title, items, text = "") {
    this.returnScope = { scope: focus.scope, current: focus.current };
    const list = h("div", { class: "modal-list", "data-group": "col" },
      ...items.map((item) => onSelect(h("div", { class: "modal-item f", text: item.label }), item.action)));
    this.el.replaceChildren(h("div", { class: "modal-box" },
      h("h2", { text: title }), text ? h("p", { text }) : null, list));
    this.el.classList.remove("is-hidden");
    this.open = true;
    focus.setScope(this.el);
  },
  close() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add("is-hidden");
    focus.setScope(this.returnScope.scope, this.returnScope.current);
  },
};
stage.append(modal.el);

// ---------- Application et routes ----------
// Routes : "/" accueil, "/categories", "/c/<catégorie>", "/v/<vidéo>", "/p/<vidéo>" (lecteur).

const app = {
  focus,
  stack: [],
  view: null,
  videos: new Map(),
  lists: new Map(),
  pending: null,

  remember(...lists) {
    for (const list of lists) for (const video of list || []) if (video?.key) this.videos.set(video.key, video);
  },
  go(route) {
    this.stack.push(route);
    show(route);
  },
  replace(route) {
    this.stack[this.stack.length - 1] = route;
    show(route);
  },
  back() {
    if (modal.open) return modal.close();
    if (this.stack.length > 1) {
      this.stack.pop();
      show(this.stack[this.stack.length - 1]);
    } else {
      confirmExit();
    }
  },
  tab(route) {
    if (this.stack[this.stack.length - 1] === route) return;
    this.stack = route === "/" ? ["/"] : ["/", route];
    show(route);
  },
  openVideo(video, list, { replace = false } = {}) {
    this.videos.set(video.key, video);
    if (list) this.lists.set(video.key, list);
    const route = `/v/${encodeURIComponent(video.key)}`;
    if (replace) this.replace(route);
    else this.go(route);
  },
  play(video, list, start = 0) {
    this.pending = { video, list, start };
    this.go(`/p/${encodeURIComponent(video.key)}`);
  },
  playReplace(video, list) {
    this.pending = { video, list, start: 0 };
    this.videos.set(video.key, video);
    this.replace(`/p/${encodeURIComponent(video.key)}`);
  },
  openSettings,
};

const views = {
  home: new HomeView(app),
  categories: new CategoriesView(app),
  detail: new DetailView(app),
  player: new Player(app),
  category: new Map(),
};
for (const view of [views.home, views.categories, views.detail, views.player]) {
  view.el.classList.add("is-hidden");
  viewsRoot.append(view.el);
}

function categoryView(key) {
  let view = views.category.get(key);
  if (!view) {
    view = new CategoryView(app, key);
    view.el.classList.add("is-hidden");
    viewsRoot.append(view.el);
    views.category.set(key, view);
    for (const [oldKey, old] of views.category) {  // garde la mémoire raisonnable
      if (views.category.size <= MAX_CATEGORY_VIEWS) break;
      if (old !== app.view) {
        old.el.remove();
        views.category.delete(oldKey);
      }
    }
  }
  return view;
}

function viewFor(kind, key) {
  if (!kind) return views.home;
  if (kind === "categories") return views.categories;
  if (kind === "c") return categoryView(key);
  if (kind === "v") return views.detail;
  if (kind === "p") return views.player;
  return views.home;
}

function switchTo(view) {
  if (app.view && app.view !== view) {
    app.view.leave?.();
    app.view.el.classList.add("is-hidden");
  }
  view.el.classList.remove("is-hidden");
  document.body.classList.toggle("in-player", view === views.player);
  app.view = view;
  view.enter?.();
}

async function resolveVideo(key) {
  const video = app.videos.get(key) || await api.video(key);
  if (!video) throw new Error("Vidéo introuvable");
  app.videos.set(key, video);
  return video;
}

async function relatedList(video) {
  if (app.lists.has(video.key)) return app.lists.get(video.key);
  if (!video.primaryCategory) return [];
  try {
    const list = await api.fullRow(video.primaryCategory);
    app.remember(list);
    app.lists.set(video.key, list);
    return list;
  } catch {
    return [];
  }
}

let navigation = 0;
async function show(route) {
  const token = ++navigation;
  history.replaceState(null, "", `#${route}`);
  const [, kind = "", rawKey = ""] = route.split("/");
  const key = decodeURIComponent(rawKey);
  const view = viewFor(kind, key);
  switchTo(view);
  // Un écran déjà visité retrouve tout de suite son focus ; un nouvel écran
  // attend son contenu (sinon le focus tomberait sur la barre d'onglets).
  if (view.lastFocus) focus.setScope(view.el, view.lastFocus);
  else {
    focus.blur();
    focus.scope = view.el;
  }
  try {
    if (view.load) await view.load();
    if (kind === "v") {
      const video = await resolveVideo(key);
      const list = await relatedList(video);
      if (token !== navigation) return;
      views.detail.show(video, list);
    } else if (kind === "p") {
      const pending = app.pending?.video.key === key ? app.pending : null;
      app.pending = null;
      const video = pending?.video || await resolveVideo(key);
      const list = pending?.list || await relatedList(video);
      const start = pending ? pending.start : store.progressOf(key)?.t || 0;
      if (token !== navigation) return;
      views.player.open(video, list, start);
    }
  } catch (error) {
    console.error("Écran indisponible", route, error);
    if (token === navigation && (kind === "v" || kind === "p")) {
      toast("Vidéo indisponible : vérifiez la connexion Internet de la TV.");
      app.back();
    }
    return;
  } finally {
    // L'écran de chargement disparaît pour de bon : son animation ne tourne plus en fond.
    const boot = document.getElementById("boot");
    if (token === navigation && boot) {
      boot.classList.add("is-hidden");
      setTimeout(() => boot.remove(), 600);
    }
  }
  if (token !== navigation) return;
  focus.setScope(view.el, view.lastFocus || view.initialFocus?.());
}

// Chaîne de retour quand l'app s'ouvre directement sur une route (rechargement).
function parents(route) {
  const [, kind = "", key = ""] = route.split("/");
  if (kind === "categories") return ["/", route];
  if (kind === "c") return ["/", "/categories", route];
  if (kind === "v") return ["/", route];
  if (kind === "p") return ["/", `/v/${key}`, route];
  return ["/"];
}

// ---------- Réglages et sortie ----------

function openSettings() {
  const s = store.settings;
  const items = [
    { label: `Qualité préférée : ${s.quality}p`, action: () => {
      const qualities = [720, 480, 360, 240];
      s.quality = qualities[(qualities.indexOf(s.quality) + 1) % qualities.length];
      store.saveSettings();
      openSettings();
    } },
    { label: `Sous-titres : ${s.subtitles ? "activés" : "désactivés"}`, action: () => {
      s.subtitles = !s.subtitles;
      store.saveSettings();
      openSettings();
    } },
    { label: "Effacer l'historique de lecture", action: () => {
      store.clearProgress();
      modal.close();
      views.home.enter();
      toast("Historique effacé");
    } },
    { label: "Fermer", action: () => modal.close() },
  ];
  const index = modal.open ? focus.focusables(modal.el).indexOf(focus.current) : 0;
  if (modal.open) {
    const saved = modal.returnScope;
    modal.show("Réglages", items, "JW Vidéos · app personnelle, vidéos lues directement sur jw.org");
    modal.returnScope = saved;
    focus.focus(focus.focusables(modal.el)[Math.max(0, index)]);
  } else {
    modal.show("Réglages", items, "JW Vidéos · app personnelle, vidéos lues directement sur jw.org");
  }
}

function confirmExit() {
  modal.show("Quitter JW Vidéos ?", [
    { label: "Annuler", action: () => modal.close() },
    { label: "Quitter", action: () => {
      console.info("Fermeture demandée (Quitter)");
      markSession(true);
      try { window.close(); } catch { /* certains moteurs refusent */ }
      setTimeout(() => {
        modal.close();
        toast("Appuyez sur la touche Accueil de la télécommande pour quitter.");
      }, 500);
    } },
  ]);
}

// ---------- Télécommande et souris ----------

document.addEventListener("keydown", (event) => {
  const code = event.keyCode;
  const inPlayer = app.view === views.player && !modal.open;
  if (BACK_CODES.has(code) || event.key === "GoBack") {
    event.preventDefault();
    if (inPlayer && views.player.onBack()) return;
    app.back();
    return;
  }
  if (inPlayer) {
    if (views.player.onKey(event)) event.preventDefault();
    return;
  }
  if (ARROWS[code]) {
    event.preventDefault();
    focus.move(ARROWS[code]);
    return;
  }
  if (code === 13) {
    event.preventDefault();
    if (!event.repeat) select(focus.current);
    return;
  }
  if (PLAY_CODES.has(code)) {  // Lecture sur une carte : lance directement la vidéo
    const data = cardData(focus.current);
    if (data?.video) {
      event.preventDefault();
      app.play(data.video, data.list, store.progressOf(data.video.key)?.t || 0);
    }
  }
});

document.addEventListener("mouseover", (event) => {
  const el = event.target.closest?.(".f");
  if (el && el !== focus.current && focus.scope.contains(el)) focus.focus(el);
});
document.addEventListener("click", (event) => {
  const el = event.target.closest?.(".f");
  if (el && focus.scope.contains(el)) {
    focus.focus(el);
    select(el);
  }
});

// ---------- Diagnostic des redémarrages ----------
// Une session qui disparaît sans être masquée ni fermée (plantage, mémoire) est
// signalée dans la console au lancement suivant.

const SESSION_KEY = "jwtv.session.v1";
function markSession(clean) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now(), clean, route: app.stack[app.stack.length - 1] || "/" }));
  } catch { /* stockage indisponible */ }
}
try {
  const previous = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  if (previous && !previous.clean && Date.now() - previous.at < 5 * 60 * 1000) {
    console.warn(`Redémarrage inattendu : la session précédente (écran ${previous.route}) ne s'est pas fermée normalement`);
  }
} catch { /* première ouverture */ }
setInterval(() => markSession(false), 20000);
window.addEventListener("pagehide", () => markSession(true));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    markSession(true);
    console.info("App masquée (touche Accueil ou autre app)");
  } else {
    markSession(false);
  }
});

// ---------- Démarrage ----------

fitStage(stage);
backdrop.init(stage);
startClock(document.getElementById("clock"));
const initial = (location.hash || "").replace(/^#/, "") || "/";
app.stack = parents(initial);
markSession(false);
show(app.stack[app.stack.length - 1]);
views.home.load().catch(() => { /* l'écran d'accueil affiche déjà l'erreur */ });
console.info(`JW Vidéos démarrée · langue ${api.LANG} · ${window.innerWidth}x${window.innerHeight}`);

// Mesure de fluidité, seulement quand l'app est servie par VidaaApp (console du PC) :
// toutes les 15 s d'utilisation, images par seconde et saccades (images de plus de 50 ms).
if (window.__vidaaDev) {
  let last = performance.now(), start = last, frames = 0, janks = 0, worst = 0, used = false;
  document.addEventListener("keydown", () => { used = true; }, true);
  const tick = (now) => {
    const gap = now - last;
    last = now;
    frames += 1;
    if (gap > 50) {
      janks += 1;
      worst = Math.max(worst, gap);
    }
    if (now - start >= 15000) {
      if (used && document.visibilityState === "visible") {
        const where = app.view === views.player ? "lecteur" : (app.stack[app.stack.length - 1] || "/");
        console.info(`Fluidité (${where}) : ${Math.round((frames * 1000) / (now - start))} img/s, ` +
          `${janks} saccade(s) > 50 ms, pire ${Math.round(worst)} ms`);
      }
      start = now;
      frames = 0;
      janks = 0;
      worst = 0;
      used = false;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
