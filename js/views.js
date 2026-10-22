// Écrans de navigation : accueil, catégories, page d'une catégorie, fiche vidéo.
import { h, icon, onSelect, clock, humanDuration, frenchDate, backdrop } from "./ui.js";
import * as api from "./api.js";
import * as store from "./store.js";

const itemOf = new WeakMap();      // carte -> { kind, video | category, list }
const RAIL_VISIBLE = 1660;         // largeur où une carte reste entière (marge droite comprise)

export function cardData(el) {
  return (el && itemOf.get(el)) || null;
}

// ---------- Cartes ----------

function progressOverlay(video) {
  const p = store.progressOf(video.key);
  if (p?.done) return h("span", { class: "watched" }, icon("check"));
  if (!p || !p.d || p.t < 15) return null;
  return h("div", { class: "card-progress" }, h("i", { style: `width:${Math.min(100, (p.t / p.d) * 100).toFixed(1)}%` }));
}

// Image suivante si jw.org refuse la première (403 sur certaines anciennes vidéos).
function withFallback(img, urls) {
  img.addEventListener("error", () => {
    const next = urls[urls.indexOf(img.dataset.src) + 1];
    if (next) {
      img.dataset.src = next;
      img.src = next;
    } else {
      img.dataset.src = "";
      img.removeAttribute("src");
    }
  });
  return img;
}

function imagesOf(video) {
  return [...(video.wides || [video.wide]), ...(video.cards || [video.card])].filter(Boolean);
}

function videoCard(video, list) {
  const card = h("div", { class: "card f" },
    h("div", { class: "card-media" },
      withFallback(h("img", { alt: "", decoding: "async", "data-src": video.card }), video.cards || [video.card]),
      video.durationText ? h("span", { class: "badge", text: video.durationText }) : null,
      progressOverlay(video)),
    h("div", { class: "card-title", text: video.title }));
  itemOf.set(card, { kind: "video", video, list });
  return card;
}

function categoryCard(category) {
  const card = h("div", { class: "card category f" },
    h("div", { class: "card-media" }, h("img", { alt: "", decoding: "async", "data-src": category.banner })),
    h("div", { class: "card-title", text: category.name }));
  itemOf.set(card, { kind: "category", category });
  return card;
}

// Met à jour barres de progression et coches « vu » après une lecture.
function refreshProgress(root) {
  for (const card of root.querySelectorAll(".card")) {
    const data = itemOf.get(card);
    if (data?.kind !== "video") continue;
    const media = card.querySelector(".card-media");
    media.querySelector(".card-progress, .watched")?.remove();
    const overlay = progressOverlay(data.video);
    if (overlay) media.append(overlay);
  }
}

// Images chargées seulement près du focus : la mémoire d'une TV est limitée.
function hydrate(rail, upTo) {
  const images = rail.querySelectorAll(".rail-track img[data-src]");
  for (let i = 0; i < images.length && i <= upTo; i++) {
    const img = images[i];
    if (img.dataset.src && !img.getAttribute("src")) img.src = img.dataset.src;
  }
}

function unload(rail) {
  for (const img of rail.querySelectorAll(".rail-track img[src]")) img.removeAttribute("src");
}

function scrollRail(rail, card) {
  let offset = rail.offset || 0;
  const left = card.offsetLeft, right = left + card.offsetWidth;
  if (left - offset < 0) offset = left;
  else if (right - offset > RAIL_VISIBLE) offset = right - RAIL_VISIBLE;
  offset = Math.max(0, offset);
  if (offset !== rail.offset) {
    rail.offset = offset;
    rail.track.style.transform = `translateX(${-offset}px)`;
  }
  hydrate(rail, Array.prototype.indexOf.call(rail.track.children, card) + 8);
}

function railElement(data, onOpen) {
  const track = h("div", { class: "rail-track" });
  const rail = h("div", { class: `rail${data.style ? " " + data.style : ""}`, "data-group": "row" },
    h("h2", { class: "rail-title", text: data.title || "" }),
    h("div", { class: "rail-viewport" }, track));
  rail.data = data;
  rail.track = track;
  rail.offset = 0;
  if (data.skeleton) {
    for (let i = 0; i < data.skeleton; i++) {
      track.append(h("div", { class: "card skeleton" }, h("div", { class: "card-media" }), h("div", { class: "card-title" })));
    }
  } else {
    fillRail(rail, data.items, onOpen);
  }
  return rail;
}

function fillRail(rail, items, onOpen, append = false) {
  const cards = items.map((item) => {
    const card = rail.data.kind === "category" ? categoryCard(item) : videoCard(item, rail.data.items);
    return onSelect(card, () => onOpen(card));
  });
  if (append) rail.track.append(...cards);
  else rail.track.replaceChildren(...cards);
}

function metaOf(video) {
  const parts = [];
  if (video.duration) parts.push(humanDuration(video.duration));
  const date = frenchDate(video.published);
  if (date) parts.push(date);
  const best = video.files[video.files.length - 1];
  if (best) parts.push(best.height >= 720 ? "HD" : best.label);
  if (video.subtitles) parts.push("Sous-titres");
  const p = store.progressOf(video.key);
  if (p && !p.done && p.t >= 15) parts.push(`Reste ${humanDuration(Math.max(0, p.d - p.t))}`);
  return parts;
}

function fillMeta(el, parts) {
  el.replaceChildren(...parts.map((text) => h("span", { text })));
}

// Zone du haut : titre, infos et description de l'élément sélectionné.
class InfoPanel {
  constructor() {
    this.eyebrow = h("div", { class: "eyebrow" });
    this.title = h("h1", { class: "title" });
    this.meta = h("div", { class: "meta" });
    this.desc = h("p", { class: "desc" });
    this.el = h("div", { class: "info" }, this.eyebrow, this.title, this.meta, this.desc);
  }

  video(v) {
    this.fill(v.category, v.title, metaOf(v), v.description);
    backdrop.set(imagesOf(v));
  }

  category(c) {
    this.fill("Catégorie", c.name, [], c.description);
    backdrop.set(c.banner);
  }

  fill(eyebrow, title, meta, desc) {
    this.eyebrow.textContent = eyebrow || "";
    this.title.textContent = title || "";
    fillMeta(this.meta, meta);
    this.desc.textContent = desc || "";
  }
}

function navBar(app, active) {
  const tab = (id, label, route) =>
    onSelect(h("div", { class: `tab f${id === active ? " is-active" : ""}`, text: label }), () => app.tab(route));
  return h("nav", { class: "nav", "data-group": "row" },
    tab("home", "Accueil", "/"),
    tab("categories", "Catégories", "/categories"),
    onSelect(h("div", { class: "tab tab-icon f" }, icon("gear")), () => app.openSettings()));
}

function skeletonRails() {
  return [{ skeleton: 4, style: "featured" }, { skeleton: 6 }];
}

// ---------- Écran à rangées (accueil et catégories) ----------

class BrowseView {
  constructor(app, name) {
    this.app = app;
    this.info = new InfoPanel();
    this.rails = h("div", { class: "rails" });
    this.el = h("section", { class: `view browse ${name}` }, this.info.el, this.rails);
    this.el.addEventListener("tvfocus", (event) => this.focused(event.target));
    this.lastFocus = null;
    this.ready = null;
  }

  load() {
    if (!this.ready) this.ready = this.build().catch((error) => {
      this.ready = null;
      this.showError(error);
      throw error;
    });
    return this.ready;
  }

  initialFocus() {
    return this.rails.querySelector(".card.f");
  }

  setRails(list) {
    this.rails.replaceChildren(...list.map((data) => railElement(data, (card) => this.open(card))));
    this.rails.style.transform = "";
    Array.from(this.rails.children).slice(0, 2).forEach((rail) => hydrate(rail, 8));
  }

  showError(error) {
    console.error("Chargement impossible", error);
    const retry = onSelect(h("div", { class: "btn f" }, "Réessayer"), () => {
      this.app.focus.blur();
      this.load().then(() => this.app.focus.setScope(this.el, this.initialFocus())).catch(() => {});
    });
    this.info.fill("Connexion", "Catalogue indisponible",
      [], "Impossible de joindre jw.org. Vérifiez la connexion Internet de la TV, puis réessayez.");
    this.rails.replaceChildren(h("div", { class: "rail error", "data-group": "row" }, retry));
    this.rails.style.transform = "";
    this.lastFocus = retry;
    if (this.app.view === this) this.app.focus.setScope(this.el, retry);
  }

  focused(target) {
    this.lastFocus = target;
    const data = itemOf.get(target);
    const rail = target.closest(".rail");
    if (rail && rail.track) {
      scrollRail(rail, target);
      this.scrollRails(rail);
      this.more(rail, target);
    } else if (!rail) {
      this.resetRails();
    }
    if (data?.kind === "video") this.info.video(data.video);
    else if (data?.kind === "category") this.info.category(data.category);
  }

  scrollRails(rail) {
    const rails = Array.from(this.rails.children);
    const index = rails.indexOf(rail);
    this.rails.style.transform = `translateY(${-rail.offsetTop}px)`;
    rails.forEach((other, i) => {
      other.classList.toggle("is-above", i < index);
      if (Math.abs(i - index) <= 1) hydrate(other, 8);
      else if (Math.abs(i - index) > 3) unload(other);
    });
  }

  resetRails() {
    this.rails.style.transform = "";
    for (const rail of this.rails.children) rail.classList.remove("is-above");
  }

  // Une rangée limitée à 24 vidéos se complète quand on approche de sa fin.
  async more(rail, card) {
    const data = rail.data;
    if (!data || data.complete || data.loading || !data.key || data.kind === "category") return;
    const index = Array.prototype.indexOf.call(rail.track.children, card);
    if (index < rail.track.children.length - 6) return;
    data.loading = true;
    try {
      const all = await api.fullRow(data.key);
      const known = new Set(data.items.map((v) => v.key));
      const extra = all.filter((v) => !known.has(v.key));
      data.items.push(...extra);
      this.app.remember(extra);
      fillRail(rail, extra, (c) => this.open(c), true);
      console.log(`Rangée « ${data.title} » complétée : ${data.items.length} vidéos`);
    } catch (error) {
      console.warn("Suite de la rangée indisponible", data.key, error);
    } finally {
      data.complete = true;
      data.loading = false;
    }
  }

  open(card) {
    const data = itemOf.get(card);
    if (data.kind === "video") this.app.openVideo(data.video, data.list);
    else this.app.go(`/c/${encodeURIComponent(data.category.key)}`);
  }
}

export class HomeView extends BrowseView {
  constructor(app) {
    super(app, "home");
    this.el.prepend(navBar(app, "home"));
  }

  async build() {
    this.info.fill("", "", [], "");
    this.setRails(skeletonRails());
    const data = await api.home();
    this.app.remember(data.featured, data.latest, ...data.studio.map((row) => row.items));
    const rails = [{ title: "À la une", items: data.featured, style: "featured", complete: true }];
    const resume = store.continueList();
    if (resume.length) rails.push({ title: "Continuer à regarder", items: resume, resume: true, complete: true });
    rails.push({ title: "Dernières vidéos", items: data.latest, complete: true });
    rails.push({ title: "Catégories", items: data.categories, kind: "category", complete: true });
    rails.push(...data.studio);
    this.setRails(rails);
  }

  enter() {
    if (!this.rails.querySelector(".card.f")) return;
    refreshProgress(this.el);
    this.updateResume();
  }

  updateResume() {
    const list = store.continueList();
    const rails = Array.from(this.rails.children);
    const rail = rails.find((r) => r.data?.resume);
    const focusedKey = rail && rail.contains(this.lastFocus) ? itemOf.get(this.lastFocus)?.video?.key : null;
    if (!list.length) {
      if (rail) {
        rail.remove();
        if (focusedKey) this.lastFocus = this.initialFocus();
      }
      return;
    }
    if (!rail) {
      const fresh = railElement({ title: "Continuer à regarder", items: list, resume: true, complete: true }, (c) => this.open(c));
      rails[0].after(fresh);
      hydrate(fresh, 8);
      return;
    }
    rail.data.items = list;
    fillRail(rail, list, (c) => this.open(c));
    rail.offset = 0;
    rail.track.style.transform = "";
    hydrate(rail, 8);
    if (focusedKey) {
      const cards = Array.from(rail.track.children);
      this.lastFocus = cards.find((c) => itemOf.get(c)?.video?.key === focusedKey) || cards[0];
    }
  }
}

export class CategoryView extends BrowseView {
  constructor(app, key) {
    super(app, "category");
    this.key = key;
    this.heading = h("div", { class: "page-title" });
    this.el.prepend(this.heading);
  }

  async build() {
    this.info.fill("Catégorie", "", [], "");
    this.setRails(skeletonRails());
    const data = await api.category(this.key, 24);
    this.heading.textContent = data.name;
    this.info.category(data);
    for (const row of data.rows) this.app.remember(row.items);
    if (!data.rows.length) {
      this.rails.replaceChildren(h("p", { class: "empty", text: "Aucune vidéo dans cette catégorie pour le moment." }));
      return;
    }
    this.setRails(data.rows);
  }

  enter() {
    refreshProgress(this.el);
  }
}

// ---------- Grille des catégories ----------

export class CategoriesView {
  constructor(app) {
    this.app = app;
    this.grid = h("div", { class: "grid", "data-group": "grid" });
    this.el = h("section", { class: "view categories" },
      navBar(app, "categories"),
      h("h1", { class: "grid-title", text: "Catégories" }),
      h("div", { class: "grid-viewport" }, this.grid));
    this.el.addEventListener("tvfocus", (event) => this.focused(event.target));
    this.lastFocus = null;
    this.ready = null;
  }

  load() {
    if (!this.ready) this.ready = api.categories().then((list) => this.render(list)).catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  initialFocus() {
    return this.grid.querySelector(".card.f");
  }

  render(list) {
    this.grid.replaceChildren(...list.map((category) => {
      const card = categoryCard(category);
      const img = card.querySelector("img");
      img.src = img.dataset.src;
      return onSelect(card, () => this.app.go(`/c/${encodeURIComponent(category.key)}`));
    }));
  }

  focused(target) {
    this.lastFocus = target;
    if (!this.grid.contains(target)) {
      this.grid.style.transform = "";
      return;
    }
    const row = Math.round(target.offsetTop / 280);
    this.grid.style.transform = `translateY(${-Math.max(0, row - 1) * 280}px)`;
    const category = itemOf.get(target)?.category;
    if (category) backdrop.set(category.banner);
  }
}

// ---------- Fiche vidéo ----------

function button(iconName, label, action) {
  return onSelect(h("div", { class: "btn f" }, iconName ? icon(iconName) : null, h("span", { text: label })), action);
}

export class DetailView {
  constructor(app) {
    this.app = app;
    this.eyebrow = h("div", { class: "eyebrow" });
    this.title = h("h1", { class: "title" });
    this.meta = h("div", { class: "meta" });
    this.desc = h("p", { class: "desc" });
    this.actions = h("div", { class: "actions", "data-group": "row" });
    this.related = railElement({ title: "Dans la même catégorie", items: [] }, (card) => this.open(card));
    this.related.classList.add("related");
    this.el = h("section", { class: "view detail" },
      h("div", { class: "detail-info" }, this.eyebrow, this.title, this.meta, this.desc, this.actions),
      this.related);
    this.el.addEventListener("tvfocus", (event) => {
      this.lastFocus = event.target;
      if (this.related.contains(event.target)) scrollRail(this.related, event.target);
    });
    this.lastFocus = null;
  }

  initialFocus() {
    return this.actions.querySelector(".f");
  }

  show(video, list) {
    this.video = video;
    this.list = list || [];
    this.eyebrow.textContent = video.category || "JW Vidéos";
    this.title.textContent = video.title;
    fillMeta(this.meta, metaOf(video));
    this.desc.textContent = video.description || "";
    backdrop.set(imagesOf(video), 0);
    const progress = store.progressOf(video.key);
    const resume = progress && !progress.done && progress.t >= 15;
    this.actions.replaceChildren(...(resume
      ? [button("play", `Reprendre · ${clock(progress.t)}`, () => this.app.play(video, this.list, progress.t)),
         button("restart", "Depuis le début", () => this.app.play(video, this.list, 0))]
      : [button("play", "Lecture", () => this.app.play(video, this.list, 0))]));
    const others = this.list.filter((v) => v.key !== video.key).slice(0, 40);
    this.related.data.items = others;
    fillRail(this.related, others, (card) => this.open(card));
    this.related.offset = 0;
    this.related.track.style.transform = "";
    this.related.classList.toggle("is-hidden", others.length === 0);
    hydrate(this.related, 10);
    this.lastFocus = this.initialFocus();
  }

  open(card) {
    const data = itemOf.get(card);
    if (data?.video) this.app.openVideo(data.video, this.list, { replace: true });
  }
}
