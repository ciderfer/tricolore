// Tricolore — fiche d'un joueur (joueur.html?id=NNNNNNN).
// Lit data/joueurs/<id>.json, écrit par la tâche planifiée (scripts/joueurs.mjs) depuis l'API publique
// de la LNH pour chaque joueur de l'alignement actuel. Aucune photo. Règle d'or : aucune donnée inventée.
(function () {
  "use strict";
  const TZ = "America/Toronto";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const loc = (o) => (o ? o.fr || o.default : "");
  const fin = (n) => typeof n === "number" && Number.isFinite(n);
  const n = (v) => (fin(v) ? String(v) : "—");
  const F = (o) => new Intl.DateTimeFormat("fr-CA", { timeZone: TZ, ...o });
  const fStamp = F({ dateStyle: "long", timeStyle: "short" });
  const fGameDay = new Intl.DateTimeFormat("fr-CA", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const fPct = new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const fGaa = new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v) => (fin(v) ? fPct.format(v).replace(/^0(?=,)/, "") : "—");
  const gaa = (v) => (fin(v) ? fGaa.format(v) : "—");
  const signed = (v) => (!fin(v) ? "—" : v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");
  const ID = new URLSearchParams(location.search).get("id") || "";

  const POS = { C: "Centre", L: "Ailier gauche", R: "Ailier droit", D: "Défenseur", G: "Gardien" };
  const COUNTRY = { CAN: "Canada", USA: "États-Unis", SWE: "Suède", FIN: "Finlande", CZE: "Tchéquie", SVK: "Slovaquie", RUS: "Russie",
    DEU: "Allemagne", GER: "Allemagne", CHE: "Suisse", SUI: "Suisse", LVA: "Lettonie", LAT: "Lettonie", DNK: "Danemark", DEN: "Danemark",
    NOR: "Norvège", AUT: "Autriche", FRA: "France", SVN: "Slovénie", BLR: "Bélarus", KAZ: "Kazakhstan", UKR: "Ukraine", GBR: "Royaume-Uni",
    AUS: "Australie", NLD: "Pays-Bas", ITA: "Italie", POL: "Pologne", HUN: "Hongrie", JPN: "Japon", KOR: "Corée du Sud" };
  const errBox = (what, detail) =>
    `<div class="err">${esc(what)} : source indisponible${detail ? ` (${esc(detail)})` : ""}. Aucune donnée affichée plutôt qu’une donnée inexacte.</div>`;
  const top = () => `<div class="top"><div class="wordmark">Tri<i></i>co<i></i>lore</div><div class="lbl"><a class="back" href="alignement.html">‹ Alignement</a></div></div>`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  function age(birth) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth || "")) return null;
    const [y, m, d] = birth.split("-").map(Number), [ty, tm, td] = today.split("-").map(Number);
    return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  }
  async function getJson(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function hero(p) {
    const g = p.position === "G";
    const a = age(p.birthDate);
    const side = { L: "gauche", R: "droite" }[p.shootsCatches];
    const birthDate = /^\d{4}-\d{2}-\d{2}$/.test(p.birthDate || "") ? new Intl.DateTimeFormat("fr-CA", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(p.birthDate + "T12:00:00Z")) : null;
    const place = [loc(p.birthCity), loc(p.birthStateProvince), COUNTRY[p.birthCountry] || p.birthCountry].filter(Boolean).join(", ");
    const ft = fin(p.heightInInches) ? `${Math.floor(p.heightInInches / 12)} pi ${p.heightInInches % 12} po` : "";
    const info = [
      ["Position", POS[p.position] || p.position],
      ["Âge", a != null ? `${a} ans${birthDate ? ` (né le ${birthDate})` : ""}` : ""],
      [g ? "Attrape" : "Lance", side ? `de la ${side}` : ""],
      ["Lieu de naissance", place],
      ["Taille", fin(p.heightInCentimeters) ? `${p.heightInCentimeters} cm${ft ? ` (${ft})` : ""}` : ""],
      ["Poids", fin(p.weightInKilograms) ? `${p.weightInKilograms} kg${fin(p.weightInPounds) ? ` (${p.weightInPounds} lb)` : ""}` : ""],
    ].filter(([, v]) => v);
    return `<section class="hero">${top()}
      <div class="pj-head"><span class="pj-no num">${fin(p.sweaterNumber) ? p.sweaterNumber : "—"}</span>
        <h1 class="pj-name cond">${esc(loc(p.firstName))}<br><span>${esc(loc(p.lastName))}</span></h1></div>
      <dl class="pj-info">${info.map(([k, v]) => `<div><dt class="lbl">${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></section>`;
  }

  const seasonLabel = (s) => (/^\d{8}$/.test(String(s)) ? `${String(s).slice(0, 4)}-${String(s).slice(4)}` : "");
  // Grille de chiffres : [libellé, valeur]
  const grid = (cells) => `<div class="pj-grid">${cells.map(([k, v]) => `<div><div class="lbl">${k}</div><div class="num pj-v">${esc(v)}</div></div>`).join("")}</div>`;
  const skaterCells = (s) => [["PJ", n(s.gamesPlayed)], ["B", n(s.goals)], ["A", n(s.assists)], ["PTS", n(s.points)], ["+/-", signed(s.plusMinus)], ["PUN", n(s.pim)], ["Tirs", n(s.shots)], ["TG moy.", s.avgToi || "—"]];
  const goalieCells = (s) => [["PJ", n(s.gamesPlayed)], ["V", n(s.wins)], ["D", n(s.losses)], ["DP", n(s.otLosses)], ["%ARR", pct(s.savePctg)], ["MOY", gaa(s.goalsAgainstAvg)], ["BL", n(s.shutouts)]];

  function season(p) {
    const g = p.position === "G", cells = g ? goalieCells : skaterCells;
    const rows = (p.seasonTotals || []);
    const reg = rows.filter((s) => s.gameTypeId === 2), po = rows.filter((s) => s.gameTypeId === 3);
    const team = (s, many) => (many ? `<p class="pj-team lbl">${esc(loc(s.teamCommonName) || "")}</p>` : "");
    const body = reg.length ? reg.map((s) => team(s, reg.length > 1) + grid(cells(s))).join("") : `<p class="pj-none">Aucun match dans la LNH cette saison.</p>`;
    const playoffs = po.length ? `<p class="pj-team lbl">Séries</p>${po.map((s) => grid(cells(s))).join("")}` : "";
    return `<section class="band"><div class="leaders-wrap"><div class="lbl band-lbl">${esc(seasonLabel(p.season))} · saison régulière</div>${body}${playoffs}
      <p class="pj-legend">${g ? "V victoires · D défaites · DP défaites en prolongation ou tirs de barrage · %ARR pourcentage d’arrêts · MOY moyenne de buts alloués · BL blanchissages"
        : "PJ parties jouées · B buts · A passes · PTS points · PUN minutes de pénalité · TG moy. temps de glace moyen"}</p></div></section>`;
  }

  function last5(p) {
    const h = `<h2 class="h cond">5 derniers matchs</h2>`;
    const games = (p.last5Games || []).filter((x) => x.gameDate);
    if (!games.length) return `<section class="blk">${h}<p class="pj-none">Aucun match récent dans la LNH.</p></section>`;
    const g = p.position === "G";
    const DEC = { W: "V", L: "D", O: "DP" };
    const rows = games.map((x) => {
      const line = g
        ? [DEC[x.decision] || "Sans décision", fin(x.shotsAgainst) && fin(x.goalsAgainst) ? `${x.shotsAgainst - x.goalsAgainst}/${x.shotsAgainst} arrêts` : "", fin(x.savePctg) ? pct(x.savePctg) : "", x.toi || ""]
        : [`${n(x.goals)} B, ${n(x.assists)} A`, `${signed(x.plusMinus)}`, fin(x.shots) ? `${x.shots} tir${x.shots > 1 ? "s" : ""}` : "", fin(x.pim) && x.pim ? `${x.pim} min` : "", x.toi || ""];
      return `<li class="pl"><span class="l5-date">${esc(fGameDay.format(new Date(x.gameDate + "T12:00:00Z")).replace(/\./g, ""))}</span>
        <span class="pl-id"><span class="pl-name cond">${x.homeRoadFlag === "H" ? "vs" : "@"} ${esc(x.opponentAbbrev || "")}</span><span class="pl-info">${line.filter(Boolean).map(esc).join(" · ")}</span></span>
        ${!g && fin(x.points) ? `<span class="l5-pts num">${x.points}</span>` : ""}</li>`;
    }).join("");
    return `<section class="blk">${h}<ul class="roster l5">${rows}</ul><p class="legend">vs à domicile · @ à l’étranger${g ? " · V victoire · D défaite · DP défaite en prolongation ou tirs de barrage" : " · à droite : points du match"}.</p></section>`;
  }

  function career(p) {
    const h = `<h2 class="h cond">Carrière LNH</h2>`;
    const c = p.careerTotals;
    if (!c || (!c.regularSeason && !c.playoffs)) return `<section class="blk white">${h}<p class="asof">Aucune statistique de carrière dans la LNH.</p></section>`;
    const g = p.position === "G";
    const cols = g ? [["PJ", (s) => n(s.gamesPlayed)], ["V", (s) => n(s.wins)], ["D", (s) => n(s.losses)], ["DP", (s) => n(s.otLosses)], ["%ARR", (s) => pct(s.savePctg)], ["MOY", (s) => gaa(s.goalsAgainstAvg)], ["BL", (s) => n(s.shutouts)]]
      : [["PJ", (s) => n(s.gamesPlayed)], ["B", (s) => n(s.goals)], ["A", (s) => n(s.assists)], ["PTS", (s) => n(s.points)], ["+/-", (s) => signed(s.plusMinus)], ["PUN", (s) => n(s.pim)]];
    const row = (label, s) => (s ? `<tr><td><span class="nm">${label}</span></td>${cols.map(([, f]) => `<td>${esc(f(s))}</td>`).join("")}</tr>` : "");
    return `<section class="blk white">${h}<table class="stats car ${g ? "g" : ""}"><thead><tr><th>Carrière</th>${cols.map(([k]) => `<th>${k}</th>`).join("")}</tr></thead>
      <tbody>${row("Saison", c.regularSeason)}${row("Séries", c.playoffs)}</tbody></table><p class="asof">Totaux en carrière dans la LNH (saison en cours incluse).</p></section>`;
  }

  async function main() {
    const app = document.getElementById("app");
    let meta = null, metaErr = null;
    try { meta = await getJson("data/meta.json"); } catch (e) { metaErr = e.message; }
    const when = meta?.updatedAt ? fStamp.format(new Date(meta.updatedAt)) : null;
    document.getElementById("foot").innerHTML = `<p>Données : API publique de la LNH${when ? ` · dernière modification le ${esc(when)} (heure de l’Est)` : ""}.</p>
      ${metaErr ? `<p class="foot-warn">Heure de mise à jour inconnue (meta.json : ${esc(metaErr)}).</p>` : ""}
      <p>Site de partisan non officiel, non affilié à la LNH ni au Club de hockey Canadien.</p>`;
    if (!/^\d{7}$/.test(ID)) {
      app.innerHTML = `<section class="hero">${top()}</section><section class="blk"><div class="err">Aucun joueur choisi (adresse incomplète). Choisissez un joueur dans l’<a href="alignement.html">alignement</a>.</div></section>`;
      return;
    }
    const fail = meta?.joueurs?.failed?.find((f) => String(f.id) === ID);
    if (meta?.sources?.roster?.ok === false || fail) {
      app.innerHTML = `<section class="hero">${top()}</section><section class="blk">${errBox("Fiche du joueur", fail ? fail.error : meta.sources.roster.error || "alignement en échec")}</section>`;
      return;
    }
    let p;
    try { p = await getJson(`data/joueurs/${ID}.json`); }
    catch (e) {
      app.innerHTML = `<section class="hero">${top()}</section><section class="blk">${e.message === "HTTP 404"
        ? `<div class="err">Ce joueur n’est pas dans l’alignement actuel du Canadien (aucune fiche).</div>` : errBox("Fiche du joueur", e.message)}</section>`;
      return;
    }
    if (String(p.playerId) !== ID) { app.innerHTML = `<section class="hero">${top()}</section><section class="blk">${errBox("Fiche du joueur", "fichier inattendu")}</section>`; return; }
    document.title = `${loc(p.firstName)} ${loc(p.lastName)} · Tricolore`;
    const parts = [() => hero(p), () => season(p), () => last5(p), () => `<div class="sleeve" aria-hidden="true"></div>`, () => career(p)];
    app.innerHTML = parts.map((fn) => { try { return fn(); } catch (e) { console.error(e); return `<div class="blk">${errBox("Section", "erreur d’affichage")}</div>`; } }).join("");
  }
  main();
})();
