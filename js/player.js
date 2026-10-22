// Lecteur plein écran : reprise, avance rapide, sous-titres, qualité, vidéo suivante.
import { h, icon, onSelect, select, clock, toast } from "./ui.js";
import * as store from "./store.js";

const HIDE_AFTER = 3500;      // ms avant de masquer les commandes pendant la lecture
const NEXT_COUNTDOWN = 8;     // s avant la vidéo suivante
const SAVE_EVERY = 5000;      // ms entre deux sauvegardes de la position
const RATES = [1, 1.25, 1.5, 0.75];

export class Player {
  constructor(app) {
    this.app = app;
    this.video = h("video", { class: "player-video", preload: "auto" });
    this.sub = h("div", { class: "p-sub" });
    this.title = h("div", { class: "p-title" });
    this.clockEl = h("div", { class: "p-clock" });
    this.buffered = h("div", { class: "bar-buffered" });
    this.played = h("div", { class: "bar-played" });
    this.thumb = h("div", { class: "bar-thumb" });
    this.time = h("span", { class: "p-time" });
    this.remaining = h("span", { class: "p-remaining" });
    this.hint = h("div", { class: "p-hint", text: "▼ Options" });
    this.panel = h("div", { class: "p-panel", "data-group": "row" });
    this.overlay = h("div", { class: "p-overlay" },
      h("div", { class: "p-top" }, h("div", {}, this.sub, this.title), this.clockEl),
      h("div", { class: "p-bottom" },
        h("div", { class: "bar" }, this.buffered, this.played, this.thumb),
        h("div", { class: "p-times" }, this.time, this.hint, this.remaining),
        this.panel));
    this.captions = h("div", { class: "p-captions" });
    this.center = h("div", { class: "p-center" });
    this.spinner = h("div", { class: "spinner p-spinner is-hidden" });
    this.message = h("div", { class: "p-message is-hidden" });
    this.nextTitle = h("div", { class: "p-next-title" });
    this.nextCount = h("div", { class: "p-next-count" });
    this.nextCard = h("div", { class: "p-next is-hidden" },
      h("div", { class: "p-next-label", text: "À suivre" }), this.nextTitle, this.nextCount,
      h("div", { class: "p-next-keys", text: "OK : lire maintenant · Retour : arrêter" }));
    this.el = h("section", { class: "view player" },
      this.video, this.captions, this.overlay, this.center, this.spinner, this.message, this.nextCard);
    this.lastFocus = null;
    this.item = null;
    this.bind();
  }

  bind() {
    const v = this.video;
    v.addEventListener("loadedmetadata", () => {
      if (this.pendingSeek > 0 && this.pendingSeek < v.duration - 5) v.currentTime = this.pendingSeek;
      this.pendingSeek = 0;
      v.playbackRate = store.settings.rate || 1;
      this.applySubtitles();
      this.updateBar();
      console.info(`Lecture : ${this.item?.title} · ${this.file?.label} · ${v.videoWidth}x${v.videoHeight}`);
    });
    v.addEventListener("timeupdate", () => {
      if (this.seekTarget == null) this.updateBar();
      if (Date.now() - this.lastSave > SAVE_EVERY) this.save();
    });
    v.addEventListener("progress", () => this.updateBar());
    v.addEventListener("waiting", () => this.spinner.classList.remove("is-hidden"));
    for (const name of ["playing", "canplay", "seeked"]) {
      v.addEventListener(name, () => this.spinner.classList.add("is-hidden"));
    }
    v.addEventListener("play", () => { this.flash("play"); this.showOverlay(); });
    v.addEventListener("pause", () => {
      if (!this.item || v.ended) return;
      this.flash("pause", true);
      this.showOverlay(true);
      this.save();
    });
    v.addEventListener("ended", () => this.ended());
    v.addEventListener("error", () => this.failed());
  }

  open(item, list, start = 0) {
    this.item = item;
    this.list = list || [];
    this.broken = new Set();
    this.lastSave = Date.now();
    this.seekTarget = null;
    this.title.textContent = item.title;
    this.sub.textContent = item.category || "JW Vidéos";
    this.message.classList.add("is-hidden");
    this.hideNext();
    this.closePanel();
    this.file = this.pickFile(store.settings.quality);
    this.load(start, true);
    this.showOverlay();
  }

  pickFile(maxHeight) {
    const files = this.item.files.filter((f) => !this.broken.has(f.url));
    return [...files].reverse().find((f) => f.height <= maxHeight) || files[0] || null;
  }

  load(position, withSubtitles) {
    const v = this.video;
    v.pause();
    v.replaceChildren();
    this.captions.replaceChildren();
    if (!this.file) {
      this.fail("Aucun fichier vidéo lisible pour cette vidéo.");
      return;
    }
    // Les sous-titres d'un autre domaine exigent une requête CORS (autorisée par jw.org).
    this.subtitlesLoaded = Boolean(withSubtitles && this.item.subtitles);
    if (this.subtitlesLoaded) {
      v.crossOrigin = "anonymous";
      v.append(h("track", { kind: "subtitles", srclang: "fr", label: "Français", src: this.item.subtitles }));
    } else {
      v.removeAttribute("crossorigin");
    }
    this.pendingSeek = position || 0;
    v.src = this.file.url;
    v.load();
    this.spinner.classList.remove("is-hidden");
    const playing = v.play();
    if (playing?.catch) playing.catch((error) => {
      // AbortError : lecture remplacée par un nouveau chargement (qualité, sous-titres) — normal.
      if (error?.name !== "AbortError") console.warn("Lecture refusée", error?.message || error);
    });
  }

  // Les sous-titres sont dessinés par l'app (piste en mode « hidden ») : même rendu
  // partout, et ils remontent quand les commandes sont affichées.
  applySubtitles() {
    const track = this.video.textTracks[0];
    this.captions.replaceChildren();
    if (!track) return;
    track.mode = store.settings.subtitles ? "hidden" : "disabled";
    track.oncuechange = () => this.renderCaptions(track);
  }

  renderCaptions(track) {
    const lines = [];
    for (const cue of Array.from(track.activeCues || [])) {
      const text = cue.getCueAsHTML ? cue.getCueAsHTML().textContent : cue.text;
      lines.push(...String(text || "").split("\n").map((line) => line.trim()).filter(Boolean));
    }
    this.captions.replaceChildren(...lines.map((line) => h("span", { text: line })));
  }

  leave() {
    clearTimeout(this.hideTimer);
    clearTimeout(this.seekTimer);
    this.hideNext();
    this.closePanel();
    if (!this.item) return;
    this.save();
    const v = this.video;
    try { v.pause(); } catch { /* déjà arrêtée */ }
    v.removeAttribute("src");
    v.replaceChildren();
    this.captions.replaceChildren();
    try { v.load(); } catch { /* libère le décodeur */ }
    this.item = null;
  }

  save() {
    const v = this.video;
    if (!this.item || !Number.isFinite(v.duration) || v.currentTime < 1) return;
    this.lastSave = Date.now();
    store.saveProgress(this.item, v.currentTime, v.duration);
  }

  updateBar(time) {
    const v = this.video;
    const duration = Number.isFinite(v.duration) ? v.duration : this.item?.duration || 0;
    const current = time ?? v.currentTime;
    const ratio = duration ? Math.min(1, current / duration) : 0;
    this.played.style.width = `${(ratio * 100).toFixed(2)}%`;
    this.thumb.style.left = `${(ratio * 100).toFixed(2)}%`;
    let buffered = 0;
    try {
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 1) buffered = Math.max(buffered, v.buffered.end(i));
      }
    } catch { /* pas encore de données */ }
    this.buffered.style.width = duration ? `${Math.min(100, (buffered / duration) * 100).toFixed(2)}%` : "0";
    this.time.textContent = clock(current);
    this.remaining.textContent = duration ? `-${clock(Math.max(0, duration - current))}` : "";
  }

  showOverlay(sticky = false) {
    this.overlay.classList.add("is-visible");
    this.el.classList.add("has-overlay");  // les sous-titres remontent au-dessus des commandes
    const now = new Date();
    this.clockEl.textContent = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    clearTimeout(this.hideTimer);
    if (!sticky && !this.panelOpen) {
      this.hideTimer = setTimeout(() => {
        if (this.video.paused || this.panelOpen) return;
        this.overlay.classList.remove("is-visible");
        this.el.classList.remove("has-overlay");
      }, HIDE_AFTER);
    }
  }

  flash(name, keep = false) {
    this.center.replaceChildren(icon(name));
    this.center.classList.remove("is-flash", "is-kept");
    void this.center.offsetWidth;  // relance l'animation
    this.center.classList.add(keep ? "is-kept" : "is-flash");
  }

  toggle() {
    const v = this.video;
    if (v.paused) v.play()?.catch?.(() => {});
    else v.pause();
  }

  // Les appuis successifs s'additionnent ; la vidéo ne saute qu'une fois relâchée.
  seek(delta) {
    const v = this.video;
    if (!Number.isFinite(v.duration)) return;
    const base = this.seekTarget ?? v.currentTime;
    this.seekTarget = Math.max(0, Math.min(v.duration - 1, base + delta));
    this.updateBar(this.seekTarget);
    this.showOverlay(true);
    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => {
      v.currentTime = this.seekTarget;
      this.seekTarget = null;
      this.showOverlay();
    }, 450);
  }

  // ---------- Options (sous-titres, qualité, vitesse) ----------

  openPanel() {
    this.panelOpen = true;
    this.renderPanel();
    this.overlay.classList.add("is-visible", "has-panel");
    clearTimeout(this.hideTimer);
    this.app.focus.setScope(this.panel, this.panel.querySelector(".f"));
  }

  closePanel() {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    this.overlay.classList.remove("has-panel");
    this.app.focus.setScope(this.el);
    this.showOverlay();
  }

  renderPanel(focusIndex = 0) {
    const s = store.settings;
    const heights = this.item.files.map((f) => f.height);
    const options = [
      [icon("cc"), `Sous-titres : ${!this.item.subtitles ? "indisponibles" : s.subtitles ? "activés" : "désactivés"}`, () => {
        if (!this.item.subtitles) return;
        s.subtitles = !s.subtitles;
        store.saveSettings();
        if (s.subtitles && !this.subtitlesLoaded) this.load(this.video.currentTime, true);
        else this.applySubtitles();
      }],
      [null, `Qualité : ${this.file ? this.file.label : "—"}`, () => {
        const sorted = [...new Set(heights)].sort((a, b) => b - a);
        const next = sorted[(sorted.indexOf(this.file.height) + 1) % sorted.length];
        s.quality = next;
        store.saveSettings();
        this.file = this.pickFile(next);
        this.load(this.video.currentTime, this.subtitlesLoaded);
        toast(`Qualité ${this.file.label}`);
      }],
      [null, `Vitesse : ${String(s.rate || 1).replace(".", ",")}×`, () => {
        s.rate = RATES[(RATES.indexOf(s.rate || 1) + 1) % RATES.length];
        store.saveSettings();
        this.video.playbackRate = s.rate;
      }],
    ];
    const buttons = options.map(([iconEl, label, action], index) =>
      onSelect(h("div", { class: "pill f" }, iconEl, h("span", { text: label })), () => {
        action();
        this.renderPanel(index);
      }));
    this.panel.replaceChildren(...buttons);
    if (this.panelOpen) this.app.focus.setScope(this.panel, buttons[focusIndex]);
  }

  // ---------- Fin de vidéo et erreurs ----------

  ended() {
    if (!this.item) return;
    store.saveProgress(this.item, this.video.duration, this.video.duration);
    const index = this.list.findIndex((v) => v.key === this.item.key);
    const next = index >= 0 ? this.list[index + 1] : null;
    if (!next) {
      setTimeout(() => this.app.back(), 1200);
      return;
    }
    this.next = next;
    this.nextTitle.textContent = next.title;
    let remaining = NEXT_COUNTDOWN;
    const tick = () => {
      this.nextCount.textContent = `Lecture dans ${remaining} s`;
      if (remaining-- <= 0) this.playNext();
      else this.nextTimer = setTimeout(tick, 1000);
    };
    this.nextCard.classList.remove("is-hidden");
    tick();
  }

  playNext() {
    const next = this.next;
    this.hideNext();
    if (next) this.app.playReplace(next, this.list);
  }

  hideNext() {
    clearTimeout(this.nextTimer);
    this.next = null;
    this.nextCard.classList.add("is-hidden");
  }

  failed() {
    if (!this.item || !this.video.getAttribute("src")) return;
    const error = this.video.error;
    console.error(`Erreur vidéo ${error?.code || "?"} : ${this.file?.url}`);
    const position = this.video.currentTime || this.pendingSeek || 0;
    if (this.subtitlesLoaded) {  // réessaie sans requête CORS ni sous-titres
      this.load(position, false);
      return;
    }
    this.broken.add(this.file.url);
    const lower = this.pickFile(this.file.height - 1);
    if (lower && !this.broken.has(lower.url)) {
      this.file = lower;
      toast(`Lecture en ${lower.label}`);
      this.load(position, false);
      return;
    }
    this.fail("Impossible de lire cette vidéo. Vérifiez la connexion Internet de la TV.");
  }

  fail(text) {
    this.spinner.classList.add("is-hidden");
    this.message.textContent = text;
    this.message.classList.remove("is-hidden");
    this.showOverlay(true);
  }

  // ---------- Télécommande ----------

  // Retour : ferme d'abord les options ; renvoie false pour quitter le lecteur.
  onBack() {
    if (this.panelOpen) {
      this.closePanel();
      return true;
    }
    return false;
  }

  onKey(event) {
    const code = event.keyCode;
    if (!this.nextCard.classList.contains("is-hidden")) {
      if (code === 13) this.playNext();
      return true;
    }
    if (this.panelOpen) {
      if (code === 37) this.app.focus.move("left");
      else if (code === 39) this.app.focus.move("right");
      else if (code === 38) this.closePanel();
      else if (code === 13 && !event.repeat) select(this.app.focus.current);
      return true;
    }
    switch (code) {
      case 13: case 463: case 179: if (!event.repeat) this.toggle(); break;
      case 415: this.video.play()?.catch?.(() => {}); break;
      case 19: this.video.pause(); break;
      case 37: this.seek(event.repeat ? -30 : -10); break;
      case 39: this.seek(event.repeat ? 30 : 10); break;
      case 412: this.seek(-30); break;
      case 417: this.seek(30); break;
      case 40: this.openPanel(); break;
      case 38: this.showOverlay(); break;
      case 413: this.app.back(); break;
      default: this.showOverlay(); return false;
    }
    return true;
  }
}
