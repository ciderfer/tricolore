// Tests de l'aperçu UX de l'accueil : jour du match dit simplement (heure de Montréal), messages sans jargon,
// carte Alertes masquable, contrastes et tailles de texte. Lancer : node --test tests/*.test.mjs
// Les données de match ci-dessous sont SYNTHÉTIQUES (équipes réelles, matchs et chiffres inventés pour le test) :
// elles ne servent qu'à faire tourner le code, jamais à l'affichage du site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");

// commun.js seul, dans un bac à sable (stockage local simulé).
function commun(storage = memStorage()) {
  const ctx = { location: { search: "" }, URLSearchParams, console, localStorage: storage };
  ctx.window = ctx;
  vm.runInNewContext(read("commun.js"), ctx);
  return ctx.T;
}
function memStorage(throws = false) {
  const m = new Map();
  return { m, getItem: (k) => { if (throws) throw new Error("bloqué"); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (throws) throw new Error("bloqué"); m.set(k, String(v)); } };
}
const T = commun();
const at = (iso) => new Date(iso);

// ---- 1. Jour du match, selon le calendrier de Montréal (America/Toronto) ----
test("jour du match : ce soir même si la date UTC est déjà le lendemain", () => {
  // 19 h à Montréal le 7 novembre = 00 h UTC le 8 novembre.
  assert.equal(T.dayLabel(at("2026-11-08T00:00:00Z"), at("2026-11-07T17:22:00Z")), "Ce soir");
  assert.equal(T.dayLabel(at("2026-11-08T00:00:00Z"), at("2026-11-08T04:59:00Z")), "Ce soir"); // 23 h 59 à Montréal
  assert.equal(T.dayLabel(at("2026-11-08T00:00:00Z"), at("2026-11-08T05:01:00Z")), ""); // 0 h 01 le lendemain : match d'hier
});

test("jour du match : après-midi, matin, demain, jour de la semaine, puis rien après 6 jours", () => {
  const now = at("2026-11-07T17:22:00Z"); // samedi 7 novembre, 12 h 22 à Montréal
  assert.equal(T.dayLabel(at("2026-11-07T18:00:00Z"), now), "Cet après-midi"); // 13 h
  assert.equal(T.dayLabel(at("2026-11-07T22:00:00Z"), now), "Ce soir"); // 17 h pile
  assert.equal(T.dayLabel(at("2026-11-07T21:30:00Z"), now), "Cet après-midi"); // 16 h 30
  assert.equal(T.dayLabel(at("2026-11-07T16:30:00Z"), now), "Aujourd’hui"); // 11 h 30
  assert.equal(T.dayLabel(at("2026-11-09T00:00:00Z"), now), "Demain"); // dimanche 19 h
  assert.equal(T.dayLabel(at("2026-11-11T00:00:00Z"), now), "Mardi"); // mardi 10 novembre, 19 h
  assert.equal(T.dayLabel(at("2026-11-14T00:00:00Z"), now), "Vendredi"); // 6 jours
  assert.equal(T.dayLabel(at("2026-11-15T00:00:00Z"), now), ""); // samedi suivant : la date suffit
});

test("jour du match : passages à l'heure d'hiver et à l'heure d'été", () => {
  // 1er novembre 2026, 2 h : retour à l'heure normale (UTC−4 → UTC−5).
  assert.equal(T.dayLabel(at("2026-11-02T00:00:00Z"), at("2026-10-31T16:00:00Z")), "Demain"); // dim. 19 h HNE
  assert.equal(T.dayLabel(at("2026-11-02T00:00:00Z"), at("2026-11-01T04:30:00Z")), "Ce soir"); // 0 h 30 HAE le 1er
  // 14 mars 2027, 2 h : heure avancée (UTC−5 → UTC−4).
  assert.equal(T.dayLabel(at("2027-03-14T23:00:00Z"), at("2027-03-13T17:00:00Z")), "Demain"); // dim. 19 h HAE
  assert.equal(T.dayLabel(at("2027-03-14T23:00:00Z"), at("2027-03-14T04:59:00Z")), "Demain"); // 23 h 59 HNE le 13
  assert.equal(T.dayLabel(at("2027-03-14T23:00:00Z"), at("2027-03-14T16:00:00Z")), "Ce soir"); // midi HAE le 14
});

// ---- 2. Messages sans jargon, mais honnêtes ----
test("message d'erreur : ce qui manque, sans code technique visible (cause gardée dans data-detail)", () => {
  const html = T.errBox("Calendrier", "HTTP 503");
  assert.equal(html, '<div class="err" data-detail="HTTP 503">Calendrier : indisponible pour le moment. Aucune donnée affichée plutôt qu’une donnée inexacte.</div>');
  assert.equal(T.errBox("Classement"), '<div class="err">Classement : indisponible pour le moment. Aucune donnée affichée plutôt qu’une donnée inexacte.</div>');
  assert.match(T.errBox("X", '<b>"'), /data-detail="&lt;b&gt;&quot;"/);
});

test("pied de page : heure inconnue et sources manquantes dites simplement, dates gardées", () => {
  const f = T.footer({ updatedAt: "2026-11-07T17:22:21Z", checkedAt: "2026-11-07T17:22:21Z" }, null, ["Calendrier"]);
  assert.match(f, /dernière modification le 7 novembre 2026 à 12 h 22, vérifiées le 7 novembre 2026 à 12 h 22 \(heure de l’Est\)/);
  assert.match(f, /Indisponible pour le moment : Calendrier\./);
  const g = T.footer(null, "HTTP 404");
  assert.match(g, />Heure de mise à jour inconnue\.</);
  assert.doesNotMatch(visible(g), /HTTP|meta\.json/);
});

// ---- 3. Carte Alertes masquable ----
test("carte Alertes : masquée sur cet appareil, et sans erreur si le stockage est bloqué", () => {
  const dev = { iOS: true, standalone: false, safari: true, push: false, denied: false };
  assert.equal(T.alertCard(dev, false), "installer");
  assert.equal(T.alertCard(dev, false, true), "");
  assert.equal(T.alertCard({ iOS: false, push: true, denied: false }, false, true), "");
  const s = memStorage(), T2 = commun(s);
  assert.equal(T2.cardHidden(), false);
  T2.hideCard();
  assert.equal(s.m.get("tricolore.carte-alertes"), "masquee");
  assert.equal(T2.cardHidden(), true);
  const T3 = commun(memStorage(true));
  assert.equal(T3.cardHidden(), false);
  assert.doesNotThrow(() => T3.hideCard());
});

test("instructions iOS en français, comme dans Safari en français", () => {
  for (const f of ["app.js", "alertes.js", "README.md"]) {
    const s = read(f);
    assert.doesNotMatch(s, /\bShare\b|Add to Home Screen/, f);
    assert.match(s, /Partager/, f);
    assert.match(s, /Sur l’écran d’accueil/, f);
  }
});

// ---- Contrastes et tailles (WCAG 2.1) calculés à partir du CSS ----
const lin = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const CSS = read("styles.css");
const color = (re) => { const m = CSS.match(re); assert.ok(m, String(re)); return m[1].toLowerCase(); };
const RED = color(/--red:(#[0-9a-fA-F]{6})/), WHITE = "#ffffff";

test("contrastes : onglets inactifs (téléphone), mois du prochain match, étiquettes sur le rouge", () => {
  assert.ok(ratio(color(/\.tabs a\{flex:none;color:(#[0-9a-f]{6})/), WHITE) >= 4.5, "onglets inactifs ≥ 4,5:1 sur le blanc");
  assert.ok(ratio(color(/\.datebig \.mo\{[^}]*color:(#[0-9a-f]{6})/), RED) >= 4.5, "mois ≥ 4,5:1 sur le rouge");
  assert.ok(ratio(color(/\.cd \.lbl\{[^}]*color:(#[0-9a-f]{6})/), RED) >= 4.5, "compte à rebours ≥ 4,5:1 sur le rouge");
  assert.ok(ratio(color(/\.ch-scale\{[^}]*color:(#[0-9a-f]{6})/), color(/--cream:(#[0-9a-f]{6})/)) >= 4.5, "échelle du graphique ≥ 4,5:1");
  assert.doesNotMatch(CSS, /#c3c8f2/i, "l'ancien lavande (4,2:1 sur le rouge) n'est plus utilisé");
});

test("tailles : aucun texte sous 12 px; boutons Actualiser et Masquer d'au moins 44 px", () => {
  for (const f of ["styles.css", "blesses.css", "alertes.css"])
    for (const [, px] of read(f).matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) assert.ok(Number(px) >= 12, `${f} : ${px} px`);
  for (const sel of ["stamp-btn", "al-x"]) assert.ok(Number(color(new RegExp(`\\.${sel}\\{[^}]*min-height:(\\d+)px`))) >= 44, sel);
});

// ---- L'accueil (app.js) rendu dans un bac à sable, avec des données synthétiques ----
const visible = (html) => html.replace(/\s(data-detail|aria-label)="[^"]*"/g, "");
function el(id) {
  return { id, innerHTML: "", handlers: {}, children: [], style: { setProperty() {} }, classList: { contains: () => false },
    setAttribute() {}, append(c) { this.children.push(c); }, addEventListener(t, f) { this.handlers[t] = f; }, querySelector: () => null,
    remove() { this.removed = true; }, focus() { this.focused = true; } };
}
async function home({ data, storage = memStorage(), ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" }) {
  const els = { app: el("app"), foot: el("foot") };
  const ctx = {
    console: { ...console, warn() {} }, URLSearchParams, Intl, Date, Promise, AbortSignal, localStorage: storage,
    location: { search: "", href: "https://ciderfer.github.io/tricolore/" },
    navigator: { userAgent: ua, platform: "iPhone", maxTouchPoints: 5 },
    matchMedia: () => ({ matches: false }), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, addEventListener() {},
    WebSocket: class { close() {} },
    fetch: async (path) => {
      const name = String(path).replace(/^data\/|\.json$/g, "");
      if (!(name in data)) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => structuredClone(data[name]) };
    },
    document: {
      hidden: false, activeElement: null, body: el("body"),
      getElementById: (id) => els[id] || null, querySelector: () => null, addEventListener() {}, createElement: () => el(""),
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("commun.js"), ctx);
  vm.runInContext(read("app.js"), ctx);
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return { html: els.app.innerHTML, els, ctx };
}

// Données synthétiques : un prochain match du CH à Toronto dans 2 jours, et le classement minimal des deux équipes.
function fixtures(over = {}) {
  const start = new Date(Date.now() + 2 * 86_400_000); start.setUTCHours(0, 0, 0, 0);
  const now = new Date().toISOString();
  const teamRow = (abbr, name, place, seq) => ({ teamAbbrev: { default: abbr }, teamName: { default: `${place} ${name}` }, teamCommonName: { default: name },
    placeName: { default: place }, divisionAbbrev: "A", conferenceAbbrev: "E", divisionSequence: seq, conferenceSequence: seq, wins: 9, losses: 5, otLosses: 2,
    points: 20, gamesPlayed: 16, homeWins: 5, homeLosses: 2, homeOtLosses: 1, roadWins: 4, roadLosses: 3, roadOtLosses: 1, goalFor: 50, goalAgainst: 45,
    streakCode: "W", streakCount: 2, date: "2026-11-07", seasonId: 20262027 });
  return {
    meta: { updatedAt: now, checkedAt: now, sources: {}, news: {} },
    schedule: { currentSeason: 20262027, games: [{ id: 2026029999, gameType: 2, gameState: "FUT", gameScheduleState: "OK", startTimeUTC: start.toISOString(),
      venue: { default: "Aréna synthétique" }, tvBroadcasts: [{ countryCode: "CA", network: "Réseau synthétique" }],
      awayTeam: { abbrev: "MTL", commonName: { default: "Canadiens" }, placeName: { default: "Montréal" } },
      homeTeam: { abbrev: "TOR", commonName: { default: "Maple Leafs" }, placeName: { default: "Toronto" } } }] },
    scoreboard: { gamesByDate: [] },
    standings: { standings: [teamRow("MTL", "Canadiens", "Montréal", 2), teamRow("TOR", "Maple Leafs", "Toronto", 3)] },
    news: { items: [] },
    ...over,
  };
}

test("accueil : jour, heure, télé, puis compte à rebours, avant le face-à-face", async () => {
  const data = fixtures();
  const { html } = await home({ data });
  const label = T.dayLabel(new Date(data.schedule.games[0].startTimeUTC));
  assert.ok(label, "match dans 2 jours : un libellé (Demain ou le jour de la semaine)");
  const pos = (s) => { const i = html.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(pos(`<p class="when cond">${label}</p>`) < pos('<div class="time">'));
  assert.ok(pos('<span class="chip">Réseau synthétique</span>') < pos('<span class="chip w">Aréna synthétique</span>'), "télé avant l'aréna");
  assert.ok(pos('<div class="cd"') < pos('<div class="faf"'), "compte à rebours avant le face-à-face");
});

test("accueil : carte Alertes en français, bouton Masquer, puis plus de carte sur cet appareil", async () => {
  const storage = memStorage();
  const first = await home({ data: fixtures(), storage });
  assert.match(first.html, /id="al-card"/);
  assert.match(first.html, /<b>Partager<\/b>.*<b>Sur l’écran d’accueil<\/b>, puis <b>Ajouter<\/b>/s);
  assert.match(first.html, /<button type="button" class="al-x"[^>]*>Masquer<\/button>/);
  // Toucher « Masquer » : la carte part, le focus va à la section suivante, le choix est gardé.
  const card = el("al-card"), next = el("next");
  card.nextElementSibling = next;
  first.els["al-card"] = card;
  first.els.app.handlers.click({ target: { closest: (s) => (s === ".al-x" ? {} : null) } });
  assert.equal(card.removed, true);
  assert.equal(next.focused, true);
  assert.equal(storage.m.get("tricolore.carte-alertes"), "masquee");
  const again = await home({ data: fixtures(), storage });
  assert.doesNotMatch(again.html, /al-card/);
});

test("accueil : calendrier en panne, message clair sans code technique visible", async () => {
  const data = fixtures();
  delete data.schedule;
  const { html } = await home({ data });
  assert.match(html, /data-detail="HTTP 503">Calendrier : indisponible pour le moment\./);
  assert.doesNotMatch(visible(html), /HTTP|fichier|meta\.json|relais|Worker/);
});

test("accueil : match en cours lu dans les fichiers du site, fraîcheur dite sans jargon", async () => {
  const data = fixtures();
  const g = { ...data.schedule.games[0], gameState: "LIVE", startTimeUTC: new Date(Date.now() - 3600e3).toISOString(),
    periodDescriptor: { number: 2, periodType: "REG" }, clock: { timeRemaining: "12:34", inIntermission: false } };
  g.awayTeam = { ...g.awayTeam, score: 2 }; g.homeTeam = { ...g.homeTeam, score: 1 };
  data.scoreboard = { gamesByDate: [{ games: [g] }] };
  const { html } = await home({ data });
  assert.match(html, /En direct · <span class="ord">2<span class="lc">e<\/span><\/span> période/);
  assert.match(html, /12:34 à jouer<small>Pointage de \d{1,2} h \d{2} \(heure de l’Est\), mis à jour aux 15 minutes environ\.<\/small>/);
  assert.doesNotMatch(visible(html), /fichiers du site|HTTP/);
});

test("téléphone : date et adversaire compacts à 320, 375 et 390 px, date lisible, ordi inchangé", () => {
  const start = CSS.indexOf("@media (max-width:1023px){\n  .datebig .day");
  assert.ok(start > CSS.indexOf(".datebig.xl .wd,.datebig.xl .mo{font-size:min(36px,9vw)}"), "après les variantes .l et .xl, pour les remplacer");
  const block = CSS.slice(start, CSS.indexOf("\n}", start));
  const sizes = {};
  for (const [, sels, px, vw] of block.matchAll(/^\s*([^{\n]+)\{font-size:min\((\d+)px,([\d.]+)vw\)\}/gm))
    for (const s of sels.split(",")) sizes[s.trim()] = (w) => Math.min(Number(px), (Number(vw) * w) / 100);
  for (const w of [320, 375, 390]) {
    for (const d of [".datebig .day", ".datebig.xl .day"]) assert.ok(sizes[d](w) >= 80 && sizes[d](w) <= 120, `${d} à ${w} px : ${sizes[d](w)}`);
    for (const s of [".datebig .wd", ".datebig.l .mo", ".datebig.xl .wd"]) assert.ok(sizes[s](w) >= 24, `${s} à ${w} px`);
    const name = sizes[".opp .name.long"](w);
    assert.ok(name >= 44 && name <= 56, `adversaire à ${w} px : ${name}`);
  }
  // Ordi : les tailles d'avant restent les règles de base.
  assert.match(CSS, /\.datebig \.day\{font-size:min\(172px,43vw\)/);
  assert.match(CSS, /\.opp \.name\{font-size:84px/);
});

// ---- Places de repêchage (course aux séries) à 320 px ----
test("repêchage, 320 px : colonnes de chiffres à la largeur du contenu, en-têtes sans espacement, 360 px et plus inchangés", () => {
  const start = CSS.indexOf("@media (max-width:359px){\n  table.wc");
  assert.ok(start > CSS.indexOf("table.wc th:nth-child(n+3),table.wc td:nth-child(n+3){width:44px}"), "après les règles de base du tableau");
  const block = CSS.slice(start, CSS.indexOf("\n}", start));
  assert.match(block, /table\.wc th:nth-child\(n\+3\),table\.wc td:nth-child\(n\+3\)\{width:auto\}/);
  assert.match(block, /table\.wc th\{letter-spacing:0\}/);
  assert.match(block, /table\.wc th,table\.wc td\{padding-left:2px;padding-right:2px\}/);
  assert.doesNotMatch(block, /font-size|display:none|visibility|text-overflow|overflow:hidden/, "rien de caché ni de rapetissé");
  // 360 px et plus : la règle de base reste.
  assert.match(CSS, /\ntable\.wc th:nth-child\(n\+3\),table\.wc td:nth-child\(n\+3\)\{width:44px\}/);
});

test("repêchage : 6 en-têtes pour 6 cellules par rangée, noms longs et valeurs au complet (données synthétiques)", async () => {
  const data = fixtures();
  // Association de l'Est synthétique : 8 équipes, dont les noms les plus longs (Hurricanes, Blue Jackets).
  const east = [["MTL", "Canadiens", "A", 2, 0, 20], ["TOR", "Maple Leafs", "A", 1, 0, 24], ["BOS", "Bruins", "A", 3, 0, 19], ["NYR", "Rangers", "M", 1, 0, 23],
    ["WSH", "Capitals", "M", 2, 0, 21], ["NJD", "Devils", "M", 3, 0, 18], ["CAR", "Hurricanes", "M", 4, 1, 18], ["CBJ", "Blue Jackets", "M", 5, 2, 17],
    ["PIT", "Penguins", "M", 6, 3, 15], ["TBL", "Lightning", "A", 4, 4, 5]];
  data.standings.standings = east.map(([abbr, name, div, ds, wc, pts], i) => ({ ...data.standings.standings[0], teamAbbrev: { default: abbr },
    teamCommonName: { default: name }, teamName: { default: name }, divisionAbbrev: div, divisionSequence: ds, conferenceSequence: i + 1,
    wildcardSequence: wc, points: pts, gamesPlayed: 17, pointPctg: pts / 34 }));
  const { html } = await home({ data });
  const table = html.match(/<table class="stats wc">[\s\S]*?<\/table>/)?.[0];
  assert.ok(table, "tableau des places de repêchage");
  const cells = (row, tag) => [...row.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1].replace(/<[^>]+>/g, ""));
  assert.deepEqual(cells(table.match(/<thead>[\s\S]*?<\/thead>/)[0], "th"), ["Rang", "Équipe", "PJ", "PTS", "%PTS", "Écart"]);
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].slice(1).map((m) => cells(m[1], "td"));
  assert.equal(rows.length, 4);
  for (const r of rows) assert.equal(r.length, 6, r.join(" | "));
  assert.deepEqual(rows[0], ["1re", "Hurricanes", "17", "18", ",529", "—"]);
  assert.deepEqual(rows[1], ["2e", "Blue Jackets", "17", "17", ",500", "—"]);
  assert.deepEqual(rows[3], ["4", "Lightning", "17", "5", ",147", "−12"]);
});
