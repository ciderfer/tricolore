// Tricolore — navigation par glissement, téléphone seulement (< 1024 px; sur ordi, le menu reste tel quel).
// La barre de sections devient une bande d'onglets collante dont le soulignement rouge suit le doigt.
// Glisser à l'horizontale mène à la page voisine (Match ‹› Calendrier ‹› Alignement); c'est un vrai changement
// de page. Les 22 px de chaque bord restent au navigateur (geste « page précédente » de Safari).
// Pas de bibliothèque; positions posées par le CSSOM (permis par la CSP).
(function () {
  "use strict";
  const nav = document.querySelector("nav.tabs"), main = document.querySelector("main");
  if (!nav || !main) return;
  const foot = document.getElementById("foot");
  const links = [...nav.querySelectorAll("a")];
  const path = (u) => new URL(u, location.href).pathname.replace(/index\.html$/, "");
  const cur = links.findIndex((a) => path(a.href) === path(location.href)); // -1 : match, fiche, alertes (pas de glissement)
  const MOBILE = matchMedia("(max-width: 1023px)"), RM = matchMedia("(prefers-reduced-motion: reduce)");
  const EDGE = 22, DUR = 280, W = () => innerWidth;
  const KEY_DIR = "tricolore-glisse", KEY_Y = "tricolore-defil", KEY_SEEN = "tricolore-glisser-vu";
  const store = (s, k, v) => { try { if (v === undefined) return JSON.parse(s.getItem(k)); s.setItem(k, JSON.stringify(v)); } catch { return null; } };

  // ---- Soulignement rouge : sous l'onglet courant, ou entre deux onglets pendant le glissement ----
  const ul = document.createElement("span");
  ul.className = "tabs-ul";
  ul.setAttribute("aria-hidden", "true");
  nav.append(ul);
  nav.classList.add("js");
  const on = links.findIndex((a) => a.getAttribute("aria-current") === "page");
  function underline(p, animate) {
    if (on < 0) { ul.hidden = true; return; }
    const i = Math.max(0, Math.min(links.length - 1, Math.floor(p))), j = Math.min(links.length - 1, i + 1), f = p - i;
    const box = (a) => { const cs = getComputedStyle(a); return [a.offsetLeft + parseFloat(cs.paddingLeft), a.offsetWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)]; };
    const [la, wa] = box(links[i]), [lb, wb] = box(links[j]);
    ul.classList.toggle("anim", !!animate && !RM.matches);
    ul.style.width = `${wa + (wb - wa) * f}px`;
    ul.style.transform = `translateX(${la + (lb - la) * f}px)`;
    const m = nav.scrollWidth - nav.clientWidth; // voisins estompés aux bords quand la bande déborde
    nav.classList.toggle("fl", nav.scrollLeft > 2);
    nav.classList.toggle("fr", nav.scrollLeft < m - 2);
  }
  const rest = () => underline(on, false);
  nav.addEventListener("scroll", rest, { passive: true });
  addEventListener("resize", rest);
  document.fonts?.ready.then(rest);
  rest();
  if (on >= 0 && MOBILE.matches) nav.scrollLeft = links[on].offsetLeft + links[on].offsetWidth / 2 - nav.clientWidth / 2; // onglet courant au centre si la bande déborde

  // ---- Départ vers une autre page : on retient le défilement et le sens, pour l'arrivée ----
  function leaving(t) {
    const ys = store(sessionStorage, KEY_Y) || {};
    ys[path(location.href)] = scrollY;
    store(sessionStorage, KEY_Y, ys);
    store(sessionStorage, KEY_DIR, { to: path(links[t].href), dir: t > cur ? 1 : -1, at: Date.now() });
  }
  nav.addEventListener("click", (e) => {
    const a = e.target.closest("a"), t = links.indexOf(a);
    if (!MOBILE.matches || t < 0 || cur < 0) return;
    if (t === cur) { e.preventDefault(); scrollTo({ top: 0, behavior: RM.matches ? "instant" : "smooth" }); return; } // onglet actif : retour en haut
    leaving(t);
  });

  // ---- Arrivée : glissement d'entrée et reprise du défilement de la dernière visite ----
  const arr = store(sessionStorage, KEY_DIR);
  if (arr && arr.to === path(location.href) && Date.now() - arr.at < 5000) {
    sessionStorage.removeItem(KEY_DIR);
    if (!RM.matches && MOBILE.matches) document.documentElement.classList.add(arr.dir > 0 ? "arrive-r" : "arrive-l");
    const y = (store(sessionStorage, KEY_Y) || {})[path(location.href)];
    if (y > 0) { // le contenu arrive après la lecture des données : on attend qu'il soit assez haut (4 s au plus)
      const t0 = Date.now();
      let quit = false; // le doigt touche l'écran : on ne déplace plus la page
      addEventListener("touchstart", () => { quit = true; }, { once: true, passive: true });
      (function wait() {
        if (quit || Date.now() - t0 > 4000) return;
        if (document.documentElement.scrollHeight - innerHeight >= y) scrollTo({ top: y, behavior: "instant" });
        else requestAnimationFrame(wait);
      })();
    }
  }

  if (cur < 0) return;

  // ---- Volet de la page voisine (la vraie page n'est pas encore chargée : on montre son nom) ----
  let peek = null;
  function showPeek(n, x) {
    if (!peek) {
      peek = document.createElement("div");
      peek.className = "peek";
      peek.setAttribute("aria-hidden", "true");
      document.body.append(peek);
    }
    const top = Math.max(0, nav.getBoundingClientRect().bottom);
    peek.style.top = `${top}px`;
    peek.textContent = n >= 0 && n < links.length ? `${n < cur ? "‹ " : ""}${links[n].textContent}${n > cur ? " ›" : ""}` : "";
    peek.hidden = !peek.textContent;
    peek.classList.toggle("prev", n < cur);
    peek.style.transform = `translate3d(${x}px,0,0)`;
  }
  function move(d, animate) {
    const tf = d ? `translate3d(${d}px,0,0)` : "";
    [main, foot, peek].forEach((el) => el?.classList.toggle("swipe-anim", !!animate));
    main.style.transform = tf;
    if (foot) foot.style.transform = tf;
    if (peek) peek.style.transform = `translate3d(${d > 0 ? d - W() : d + W()}px,0,0)`;
  }
  function reset() {
    move(0, false);
    if (peek) peek.hidden = true;
    underline(on, false);
    busy = false;
  }
  let tr = null, busy = false, timer = 0;
  // Zone qui défile déjà à l'horizontale (tableau large, bande d'onglets) : le glissement lui appartient.
  const scrollsX = (el) => { for (; el && el !== document.body; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true; return false; };
  addEventListener("touchstart", (e) => {
    tr = null;
    stopNudge();
    if (busy || !MOBILE.matches || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX < EDGE || t.clientX > W() - EDGE || scrollsX(e.target)) return;
    tr = { x0: t.clientX, y0: t.clientY, lock: null, d: 0, pts: [[t.clientX, e.timeStamp]] };
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (!tr) return;
    const t = e.touches[0], dx = t.clientX - tr.x0, dy = t.clientY - tr.y0;
    if (!tr.lock) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      tr.lock = Math.abs(dx) > Math.abs(dy) * 1.15 ? "x" : "y"; // sens verrouillé pour tout le geste
      if (tr.lock === "y") { tr = null; return; }
    }
    if (e.cancelable) e.preventDefault(); // la page ne défile pas pendant un glissement horizontal
    let d = dx;
    const n = cur + (d > 0 ? -1 : 1);
    if (n < 0 || n >= links.length) d *= 0.28; // élastique à la première et à la dernière page
    tr.d = d;
    tr.pts.push([t.clientX, e.timeStamp]);
    if (tr.pts.length > 5) tr.pts.shift();
    showPeek(n, 0);
    move(d, false);
    underline(Math.max(0, Math.min(links.length - 1, cur - d / W())), false);
  }, { passive: false });
  function end(cancel) {
    if (!tr) return;
    const s = tr;
    tr = null;
    if (s.lock !== "x") return;
    const w = W(), a = s.pts[0], b = s.pts[s.pts.length - 1], v = b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0;
    let t = cur;
    if (!cancel) {
      if (s.d < -w * 0.28 || (v < -0.35 && s.d < 0)) t = cur + 1;
      else if (s.d > w * 0.28 || (v > 0.35 && s.d > 0)) t = cur - 1;
    }
    busy = true;
    if (t < 0 || t >= links.length || t === cur) { // retour en place
      move(0, true);
      underline(cur, true);
      clearTimeout(timer);
      timer = setTimeout(reset, RM.matches ? 0 : DUR + 40);
      return;
    }
    leaving(t);
    underline(t, true);
    if (RM.matches) { location.href = links[t].href; return; } // mouvement réduit : changement immédiat
    move(t > cur ? -w : w, true);
    setTimeout(() => { location.href = links[t].href; }, DUR);
  }
  addEventListener("touchend", () => end(false), { passive: true });
  addEventListener("touchcancel", () => end(true), { passive: true });
  // Retour par le bouton « précédent » : la page sort du cache telle qu'on l'a quittée, on la remet en place.
  addEventListener("pageshow", (e) => { if (e.persisted) reset(); });

  // ---- Indice de première visite : la page s'écarte un instant pour montrer la voisine, une seule fois ----
  let nudgeT = [];
  function stopNudge() {
    if (!nudgeT.length) return;
    nudgeT.forEach(clearTimeout);
    nudgeT = [];
    reset();
  }
  const seen = store(localStorage, KEY_SEEN);
  store(localStorage, KEY_SEEN, 1);
  if (!seen && MOBILE.matches && !RM.matches && cur < links.length - 1 && !new URLSearchParams(location.search).has("sansindice")) {
    nudgeT = [
      setTimeout(() => { showPeek(cur + 1, 0); move(0, false); void main.offsetWidth; move(-44, true); underline(cur + 44 / W(), true); }, 1200),
      setTimeout(() => { move(0, true); underline(cur, true); }, 1200 + DUR + 600),
      setTimeout(() => { nudgeT = []; reset(); }, 1200 + 2 * DUR + 700),
    ];
  }
})();
