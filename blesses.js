// Tricolore — section « Blessés » de la page Alignement (lit data/injuries.json, écrit par scripts/fetch-injuries.mjs).
// Source : API publique non officielle d'ESPN, champs structurés seulement. Les dates de retour sont des estimations.
// Règle d'or : aucune donnée inventée. Fichier absent, illisible, en échec (players null, CH absent d'ESPN) ou de plus
// de 3 jours : « données indisponibles », aucune liste (jamais « Aucun blessé signalé » sans le savoir).
// Script classique (chargé avant alignement.js) : expose window.TB; sous Node (tests), module.exports.
(function (root) {
  "use strict";
  const TZ = "America/Toronto";
  const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
  const STATUS = { "Injured Reserve": "Liste des blessés", "Day-To-Day": "Au jour le jour", "Out": "Absent" };
  const STATUS_CLASS = { "Injured Reserve": "lb", "Day-To-Day": "jj", "Out": "abs" };
  const ORDER = ["Day-To-Day", "Out", "Injured Reserve"]; // du retour le plus proche au plus lointain
  const TYPE = { "Upper Body": "Haut du corps", "Lower Body": "Bas du corps", "Undisclosed": "Non divulguée" };
  const POS = { C: "C", LW: "AG", RW: "AD", D: "D", G: "G" };
  const POS_LONG = { C: "Centre", LW: "Ailier gauche", RW: "Ailier droit", D: "Défenseur", G: "Gardien" };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const loc = (o) => (o ? o.fr || o.default || "" : "");
  const F = (o) => new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, ...o });
  const fDay = F({ day: "numeric", month: "short" });
  const fTime = F({ hour: "numeric", minute: "2-digit", hourCycle: "h23" });
  const fRet = new Intl.DateTimeFormat("fr-CA", { timeZone: "UTC", day: "numeric", month: "short" });

  // Traductions (vocabulaire RDS/TVA). Valeur inconnue : texte brut d'ESPN plutôt que rien.
  const statusText = (s) => STATUS[s] || s || "Statut inconnu";
  const typeText = (t) => TYPE[t] || t || "";
  // « 2026-10-31 » → « 31 oct. » (date sans heure : lue en UTC pour ne pas reculer d'un jour)
  const returnText = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? fRet.format(new Date(`${ymd}T12:00:00Z`)) : "");
  // « 23 oct., 19 h 05 » (heure de l'Est)
  function stamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(+d)) return "";
    return `${fDay.format(d)}, ${fTime.format(d).replace(":", " h ")}`;
  }

  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  // Joueur ESPN → joueur de roster.json : même nom de famille et même initiale du prénom
  // (« Sam » = « Samuel » Montembeault; Florian ≠ Arber Xhekaj). Ambigu ou absent : null.
  function match(roster, p) {
    const all = ["forwards", "defensemen", "goalies"].flatMap((k) => (Array.isArray(roster?.[k]) ? roster[k] : []));
    const ln = norm(p?.lastName), fi = norm(p?.firstName).charAt(0);
    if (!ln || !fi) return null;
    const hits = all.filter((x) => norm(loc(x.lastName)) === ln && norm(loc(x.firstName)).charAt(0) === fi);
    return hits.length === 1 ? hits[0] : null;
  }

  // État des données : "ok" (liste, possiblement vide), "stale" (plus de 3 jours), "error" (absent ou illisible).
  function state(inj, now) {
    if (!inj || !Array.isArray(inj.players)) return "error";
    const t = Date.parse(inj.fetchedAt);
    if (!Number.isFinite(t)) return "error";
    return now - t > MAX_AGE_MS ? "stale" : "ok";
  }

  // Identifiants LNH des joueurs blessés (pastille « Blessé » de l'alignement). Vide si les données ne sont pas fiables.
  function injuredIds(inj, roster, now) {
    if (state(inj, now) !== "ok") return new Set();
    return new Set(inj.players.map((p) => match(roster, p)?.id).filter((id) => id != null));
  }

  const errBox = (detail) =>
    `<div class="err">Blessés : données indisponibles${detail ? ` (${esc(detail)})` : ""}. Aucune donnée affichée plutôt qu’une donnée inexacte.</div>`;

  function row(p, roster) {
    const m = match(roster, p);
    const ret = returnText(p.returnDate);
    const info = [typeText(p.type), ret ? `Retour estimé : ${ret}` : ""].filter(Boolean).join(" · ");
    const body = `<span class="pl-name cond">${esc(p.name)}</span><span class="pl-info">${esc(info)}</span>`;
    const id = m ? `<a class="pl-id pl-link" href="joueur.html?id=${encodeURIComponent(m.id)}">${body}</a>` : `<span class="pl-id">${body}</span>`;
    const no = m && Number.isFinite(m.sweaterNumber) ? m.sweaterNumber : "—";
    return `<li class="pl inj"><span class="inj-no"><span class="num">${esc(no)}</span><abbr class="lbl" title="${esc(POS_LONG[p.pos] || "")}">${esc(POS[p.pos] || p.pos || "")}</abbr></span>${id}</li>`;
  }

  // HTML de la section. errDetail : raison de l'échec de lecture du fichier (ex. « HTTP 404 »).
  function section(inj, roster, now, errDetail) {
    const h = `<h2 class="h cond">Blessés</h2>`;
    const st = state(inj, now);
    if (st !== "ok") return `<section class="blk white inj-blk">${h}${errBox(st === "stale" ? "aucune mise à jour depuis plus de 3 jours" : errDetail || inj?.error || (inj ? "fichier illisible" : "fichier absent"))}</section>`;
    const when = stamp(inj.fetchedAt);
    if (!inj.players.length)
      return `<section class="blk white inj-blk">${h}<p class="inj-none">Aucun blessé signalé.</p><p class="asof inj-src">Source : ESPN · mis à jour le ${esc(when)}.</p></section>`;
    const byRet = (a, b) => (a.returnDate || "9999").localeCompare(b.returnDate || "9999") || norm(a.lastName).localeCompare(norm(b.lastName));
    const rank = (s) => (ORDER.indexOf(s) + 1) || 9;
    const statuses = [...new Set(inj.players.map((p) => p.status))].sort((a, b) => rank(a) - rank(b));
    const groups = statuses.map((s) => {
      const list = inj.players.filter((p) => p.status === s).sort(byRet);
      return `<div class="inj-grp"><h3 class="grp lbl ${STATUS_CLASS[s] || ""}">${esc(statusText(s))} <span>${list.length}</span></h3><ul class="roster inj-list">${list.map((p) => row(p, roster)).join("")}</ul></div>`;
    }).join("");
    return `<section class="blk white inj-blk"><h2 class="h cond">Blessés <span class="num">${inj.players.length}</span></h2><div class="inj-grps">${groups}</div>
      <p class="asof inj-src">Source : ESPN · mis à jour le ${esc(when)}. Les dates de retour sont des estimations, pas des annonces du club.</p></section>`;
  }

  const api = { MAX_AGE_MS, statusText, typeText, returnText, stamp, match, state, injuredIds, section };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TB = api;
})(typeof window !== "undefined" ? window : globalThis);
