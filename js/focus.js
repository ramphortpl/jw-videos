// Navigation à la télécommande, façon Apple TV.
// Les éléments navigables portent la classe "f". Leurs conteneurs déclarent :
//   data-group="row"  rangée horizontale (gauche/droite dans la rangée)
//   data-group="col"  liste verticale (haut/bas dans la liste)
//   data-group="grid" grille (déplacement géométrique)
// En quittant un groupe vers le haut ou le bas, on retrouve le dernier élément
// visité dans le groupe d'arrivée (mémoire de position, comme sur tvOS).
export class FocusManager {
  constructor() {
    this.current = null;
    this.scope = document.body;
    this.memory = new WeakMap();
  }

  setScope(root, preferred) {
    this.scope = root;
    const target = preferred && root.contains(preferred) && visible(preferred) ? preferred : this.focusables()[0];
    if (target) this.focus(target);
    else this.blur();
  }

  focusables(root = this.scope) {
    return Array.from(root.querySelectorAll(".f")).filter(visible);
  }

  blur() {
    if (this.current) this.current.classList.remove("is-focused");
    this.current = null;
  }

  focus(el) {
    if (!el) return;
    if (el !== this.current) {
      this.blur();
      this.current = el;
      el.classList.add("is-focused");
    }
    const group = el.closest("[data-group]");
    if (group) this.memory.set(group, el);
    el.dispatchEvent(new CustomEvent("tvfocus", { bubbles: true }));
  }

  move(direction) {
    const cur = this.current;
    if (!cur || !this.scope.contains(cur) || !visible(cur)) {
      const first = this.focusables()[0];
      if (first) this.focus(first);
      return Boolean(first);
    }
    const group = cur.closest("[data-group]");
    const axis = group ? group.dataset.group : "";
    const horizontal = direction === "left" || direction === "right";
    const backwards = direction === "left" || direction === "up";
    if ((axis === "row" && horizontal) || (axis === "col" && !horizontal)) {
      const items = this.focusables(group);
      const next = items[items.indexOf(cur) + (backwards ? -1 : 1)];
      if (next) {
        this.focus(next);
        return true;
      }
      if (axis === "row") return false;  // bout de rangée
    }
    if (axis === "grid") {
      const next = nearest(cur, direction, this.focusables(group));
      if (next) {
        this.focus(next);
        return true;
      }
    }
    // Rangée voisine directe (cas le plus fréquent) : seuls ses éléments sont mesurés,
    // au lieu de tous ceux de l'écran — nettement plus rapide sur une TV.
    if (!horizontal && group) {
      const sibling = siblingGroup(group, backwards);
      const items = sibling ? this.focusables(sibling) : [];
      if (items.length) {
        const remembered = this.memory.get(sibling);
        this.focus(remembered && items.includes(remembered) ? remembered : closestX(cur, items));
        return true;
      }
    }
    const outside = this.focusables().filter((el) => !group || !group.contains(el));
    const best = horizontal ? nearest(cur, direction, outside) : nextRow(cur, direction, outside);
    if (!best) return false;
    const target = best.closest("[data-group]");
    const remembered = target && !horizontal ? this.memory.get(target) : null;
    this.focus(remembered && target.contains(remembered) && visible(remembered) ? remembered : best);
    return true;
  }
}

function visible(el) {
  return el.offsetParent !== null;
}

function siblingGroup(group, backwards) {
  let el = backwards ? group.previousElementSibling : group.nextElementSibling;
  while (el && !el.dataset.group) el = backwards ? el.previousElementSibling : el.nextElementSibling;
  return el;
}

function closestX(from, items) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  let best = items[0], bestDx = Infinity;
  for (const el of items) {
    const b = el.getBoundingClientRect();
    const dx = Math.abs(b.left + b.width / 2 - ax);
    if (dx < bestDx) {
      bestDx = dx;
      best = el;
    }
  }
  return best;
}

// Haut / bas : d'abord la rangée immédiatement voisine (même si ses cartes sont
// décalées), puis la carte la plus proche horizontalement dans cette rangée.
function nextRow(from, direction, candidates) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  const found = [];
  for (const el of candidates) {
    const b = el.getBoundingClientRect();
    const dy = b.top + b.height / 2 - ay;
    if (direction === "down" ? dy <= 1 : dy >= -1) continue;
    found.push({ el, gap: direction === "down" ? b.top - a.bottom : a.top - b.bottom, dx: Math.abs(b.left + b.width / 2 - ax) });
  }
  if (!found.length) return null;
  const closest = Math.min(...found.map((c) => c.gap));
  return found.filter((c) => c.gap <= closest + 40).sort((p, q) => p.dx - q.dx)[0].el;
}

function nearest(from, direction, candidates) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of candidates) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    const along = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    if (along <= 1) continue;
    const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}
