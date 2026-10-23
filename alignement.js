// Tricolore — page Alignement et statistiques.
// Lit data/roster.json et data/stats.json (écrits par scripts/fetch-data.mjs depuis l'API publique de la LNH)
// et data/injuries.json (scripts/fetch-injuries.mjs, ESPN; section affichée par blesses.js).
// Règle d'or : aucune donnée inventée. Si une source manque, on affiche un message clair.
(function () {
  "use strict";
  const { esc, loc, fin, pct, gaa, signed, age, WORDMARK, errBox } = T;

  const SOURCE_LABEL = { roster: "Alignement", stats: "Statistiques", injuries: "Blessés" };

  const POS = { C: "Centre", L: "Ailier gauche", R: "Ailier droit", D: "Défenseur", G: "Gardien" };
  const POS_BAR = { C: "Centre", L: "Ailier g.", R: "Ailier d.", D: "Défenseur" };
  const SIDE = { L: "gauche", R: "droite" };
  const shortName = (p) => `${loc(p.firstName).charAt(0)}. ${loc(p.lastName)}`;
  function header(d) {
    return `<section class="hero page-hero"><div class="top"><div class="wordmark">${WORDMARK}</div><div class="lbl">${esc(T.season(d.stats?.season))}</div></div>
      <h1 class="page-title cond">Alignement<br><span>et statistiques</span></h1></section>`;
  }

  function leaders(d) {
    const sk = d.stats?.skaters;
    if (!Array.isArray(sk)) return `<section class="band"><div class="leaders-wrap">${errBox("Meneurs", d.errors.stats || "données absentes")}</div></section>`;
    const played = sk.filter((p) => fin(p.gamesPlayed) && p.gamesPlayed > 0);
    const cat = (key, label) => {
      const vals = played.filter((p) => fin(p[key]));
      const best = Math.max(...vals.map((p) => p[key]));
      if (!vals.length || !(best > 0)) return `<div class="ldr"><div class="lbl">${label}</div><div class="ldr-v num">—</div><div class="ldr-n">Personne encore</div></div>`;
      const top = vals.filter((p) => p[key] === best).sort((a, b) => loc(a.lastName).localeCompare(loc(b.lastName), "fr"));
      const names = top.slice(0, 2).map((p) => esc(loc(p.lastName))).join(", ") + (top.length > 2 ? ` +${top.length - 2}` : "");
      return `<div class="ldr"><div class="lbl">${label}</div><div class="ldr-v num">${best}</div><div class="ldr-n cond">${names}</div></div>`;
    };
    return `<section class="band"><div class="leaders-wrap"><div class="lbl band-lbl">Meneurs du CH</div><div class="leaders">
      ${cat("points", "Points")}${cat("goals", "Buts")}${cat("assists", "Passes")}</div></div></section>`;
  }

  function roster(d) {
    const hurt = TB.injuredIds(d.injuries, d.roster, Date.now());
    const h = `<h2 class="h cond">Alignement</h2>`;
    const r = d.roster;
    if (!r || !Array.isArray(r.forwards)) return `<section class="blk">${h}${errBox("Alignement", d.errors.roster || "données absentes")}</section>`;
    const group = (title, list) => {
      if (!Array.isArray(list) || !list.length) return "";
      const rows = [...list].sort((a, b) => (a.sweaterNumber ?? 999) - (b.sweaterNumber ?? 999)).map((p) => {
        const a = age(p.birthDate);
        const hand = SIDE[p.shootsCatches] ? `${p.positionCode === "G" ? "Attrape" : "Lance"} de la ${SIDE[p.shootsCatches]}` : "";
        const info = [POS[p.positionCode] || p.positionCode, a != null ? `${a} ans` : "", hand].filter(Boolean).join(" · ");
        return `<li class="pl"><span class="pl-no num">${fin(p.sweaterNumber) ? p.sweaterNumber : "—"}</span>
          <a class="pl-id pl-link" href="joueur.html?id=${encodeURIComponent(p.id)}"><span class="pl-name cond">${esc(loc(p.firstName))} ${esc(loc(p.lastName))}</span><span class="pl-info">${esc(info)}${hurt.has(p.id) ? `<b class="pl-inj">Blessé</b>` : ""}</span></a></li>`;
      }).join("");
      return `<h3 class="grp lbl">${title} <span>${list.length}</span></h3><ul class="roster">${rows}</ul>`;
    };
    return `<section class="blk">${h}${group("Attaquants", r.forwards)}${group("Défenseurs", r.defensemen)}${group("Gardiens", r.goalies)}</section>`;
  }

  // Nom dans les tableaux : lien vers la fiche si le joueur est dans l'alignement actuel (fiche générée).
  function nameCell(d, p) {
    const ids = new Set(["forwards", "defensemen", "goalies"].flatMap((k) => d.roster?.[k] || []).map((x) => x.id));
    const nm = `<span class="nm">${esc(shortName(p))}</span>`;
    return ids.has(p.playerId) ? `<a class="nm-link" href="joueur.html?id=${encodeURIComponent(p.playerId)}">${nm}</a>` : nm;
  }

  function gameTypeText(gt) { return gt === 3 ? "Séries" : gt === 1 ? "Préparatoire" : "Saison régulière"; }

  // Patineurs : une barre par joueur (buts en rouge, passes en bleu, points au bout), attaquants ou défenseurs,
  // à la même échelle. Toucher un joueur affiche son profil (radar) : chaque axe le compare au meilleur du CH
  // à sa position. view garde l'état de l'affichage (dessiné par draw() une fois la page en place).
  let view = null;
  function skaters(d) {
    const h = `<h2 class="h cond">Patineurs</h2>`;
    const s = d.stats;
    if (!s || !Array.isArray(s.skaters)) return `<section class="blk white">${h}${errBox("Statistiques", d.errors.stats || "données absentes")}</section>`;
    const list = s.skaters.filter((p) => fin(p.gamesPlayed) && p.gamesPlayed > 0)
      .sort((a, b) => b.points - a.points || b.goals - a.goals || a.gamesPlayed - b.gamesPlayed || loc(a.lastName).localeCompare(loc(b.lastName), "fr"));
    if (!list.length) return `<section class="blk white">${h}<p class="asof">Aucun match joué pour l’instant.</p></section>`;
    const groups = { f: list.filter((p) => p.positionCode !== "D"), d: list.filter((p) => p.positionCode === "D") };
    const top = Math.max(...list.map((p) => (fin(p.points) ? p.points : 0)));
    const roster = ["forwards", "defensemen", "goalies"].flatMap((k) => d.roster?.[k] || []);
    view = { d, groups, grp: groups.f.length ? "f" : "d", sel: { f: groups.f[0]?.playerId, d: groups.d[0]?.playerId },
      sc: Math.max(4, Math.ceil(top / 4) * 4), no: new Map(roster.map((p) => [p.id, p.sweaterNumber])) };
    const seg = (g, label) => `<button type="button" data-grp="${g}"${groups[g].length ? "" : " disabled"}>${label}<span class="num">${groups[g].length}</span></button>`;
    return `<section class="blk white sk-blk">${h}<p class="tbl-sub lbl">${esc(gameTypeText(s.gameType))}</p>
      <div class="seg" role="group" aria-label="Position">${seg("f", "Attaquants")}${seg("d", "Défenseurs")}</div>
      <p class="ch-key lbl"><span><i class="k-g"></i>Buts</span><span><i class="k-a"></i>Passes</span><span class="tot">Points</span></p>
      <ul class="chart"></ul><div class="ch-scale" aria-hidden="true"></div>
      <p class="asof">Touchez un joueur pour voir son profil. Classés par points, puis par buts. Même échelle pour attaquants et défenseurs. Seuls les joueurs ayant joué sont listés.</p></section>
      <section class="prof" aria-live="polite"></section>`;
  }

  const n = (v) => (fin(v) ? v : "—");
  const toi = (sec) => (fin(sec) ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}` : "—");
  const perGame = (p) => (fin(p.points) && p.gamesPlayed > 0 ? p.points / p.gamesPlayed : null);
  function bar(p) {
    const sel = p.playerId === view.sel[view.grp];
    const ok = fin(p.goals) && fin(p.assists);
    const w = (v) => (v / view.sc) * 100;
    const fill = !ok ? `<span class="b-na">données absentes</span>`
      : !(p.goals + p.assists) ? `<span class="b-na">aucun point</span>`
      : `<span class="b-g" data-w="${w(p.goals)}">${p.goals && w(p.goals) >= 7 ? p.goals : ""}</span><span class="b-a" data-w="${w(p.assists)}">${p.assists && w(p.assists) >= 7 ? p.assists : ""}</span>`;
    const label = `${loc(p.firstName)} ${loc(p.lastName)} : ${ok ? `${p.goals} buts, ${p.assists} passes, ` : ""}${n(p.points)} points en ${p.gamesPlayed} matchs`;
    return `<li><button type="button" class="bar" data-id="${esc(p.playerId)}" aria-pressed="${sel}" aria-label="${esc(label)}">
      <span class="b-no num">${esc(view.no.get(p.playerId) ?? "")}</span>
      <span class="b-nm"><b>${esc(shortName(p))}</b><small>${esc(POS_BAR[p.positionCode] || p.positionCode || "")} · ${p.gamesPlayed} PJ</small></span>
      <span class="b-tr">${fill}</span><span class="b-p num">${n(p.points)}</span></button></li>`;
  }

  // Radar : valeur du joueur / meilleure valeur du CH à sa position (attaquants ou défenseurs) sur chaque axe.
  const AXES = [
    ["Buts", (p) => p.goals, (p) => n(p.goals)],
    ["Passes", (p) => p.assists, (p) => n(p.assists)],
    ["Tirs", (p) => p.shots, (p) => n(p.shots)],
    ["Temps de glace", (p) => p.avgTimeOnIcePerGame, (p) => toi(p.avgTimeOnIcePerGame)],
    ["Pts / match", perGame, (p) => (fin(perGame(p)) ? perGame(p).toFixed(2).replace(".", ",") : "—")],
  ];
  function profile() {
    const list = view.groups[view.grp], p = list.find((x) => x.playerId === view.sel[view.grp]);
    if (!p) return "";
    const N = AXES.length, cx = 160, cy = 128, r = 88;
    const pt = (i, f) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / N; return [cx + Math.cos(a) * r * f, cy + Math.sin(a) * r * f]; };
    const pts = (fs) => fs.map((f, i) => pt(i, f).map((v) => v.toFixed(1)).join(",")).join(" ");
    const rings = [1, 0.75, 0.5, 0.25].map((f, k) => `<polygon class="ring${k % 2}" points="${pts(AXES.map(() => f))}"/>`).join("");
    const vals = AXES.map(([, get]) => {
      const v = get(p), best = Math.max(0, ...list.map(get).filter(fin));
      return fin(v) && best > 0 ? Math.max(0.03, Math.max(0, v) / best) : 0.03;
    });
    const dots = vals.map((f, i) => { const [x, y] = pt(i, f); return `<rect class="dot" x="${(x - 3).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="6" height="6"/>`; }).join("");
    const labels = AXES.map(([name, , show], i) => {
      const [x, y] = pt(i, 1.2);
      const anc = Math.abs(x - cx) < 5 ? "middle" : x > cx ? "start" : "end";
      const dy = y < cy - 40 ? -14 : y > cy + 40 ? 4 : -6;
      return `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anc}">${name}</text><text class="v" x="${x.toFixed(1)}" y="${(y + dy + 16).toFixed(1)}" text-anchor="${anc}">${esc(show(p))}</text>`;
    }).join("");
    const who = view.grp === "f" ? "attaquant" : "défenseur";
    const name = `${loc(p.firstName)} ${loc(p.lastName)}`;
    const missing = AXES.filter(([, get]) => !fin(get(p))).map(([a]) => a);
    const linked = view.no.has(p.playerId);
    const no = view.no.get(p.playerId);
    return `<span class="lbl">Profil du joueur</span>
      <div class="prof-hd"><span class="prof-no num">${fin(no) ? no : ""}</span><h3 class="prof-nm cond">${esc(name)}<small>${esc(POS[p.positionCode] || p.positionCode || "")} · ${p.gamesPlayed} match${p.gamesPlayed > 1 ? "s" : ""} joué${p.gamesPlayed > 1 ? "s" : ""}</small></h3></div>
      <svg class="radar" viewBox="0 0 320 262" role="img" aria-label="Profil de ${esc(name)} comparé au meilleur ${who} du CH sur chaque axe">${rings}<polygon class="shape" points="${pts(vals)}"/>${dots}${labels}</svg>
      <div class="pgrid"><div><div class="lbl">Points</div><div class="v num">${n(p.points)}</div></div><div><div class="lbl">+/−</div><div class="v num">${signed(p.plusMinus)}</div></div><div><div class="lbl">Buts en A.N.</div><div class="v num">${n(p.powerPlayGoals)}</div></div></div>
      <p class="prof-note">Le bord du radar : le meilleur ${who} du CH sur cet axe. Temps de glace : moyenne par match.${missing.length ? ` Donnée absente de la LNH : ${esc(missing.join(", "))} (au centre).` : ""}</p>
      ${linked ? `<a class="more" href="joueur.html?id=${encodeURIComponent(p.playerId)}">Fiche de ${esc(loc(p.lastName))} ›</a>` : ""}`;
  }

  function draw() {
    const blk = document.querySelector(".sk-blk");
    if (!blk || !view) return;
    blk.querySelector(".chart").innerHTML = view.groups[view.grp].map(bar).join("");
    // Largeurs par le CSSOM (permis par la CSP, contrairement aux attributs style="").
    blk.querySelectorAll("[data-w]").forEach((el) => { el.style.width = `${el.dataset.w}%`; });
    blk.querySelector(".ch-scale").innerHTML = `<div>${[0, 1, 2, 3, 4].map((k) => `<span>${(view.sc * k) / 4}</span>`).join("")}</div>`;
    blk.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.grp === view.grp)));
    document.querySelector(".prof").innerHTML = profile();
  }
  document.getElementById("app").addEventListener("click", (e) => {
    const seg = e.target.closest(".seg button"), b = e.target.closest(".bar");
    if (seg) { view.grp = seg.dataset.grp; draw(); }
    if (!b) return;
    view.sel[view.grp] = Number(b.dataset.id);
    draw();
    document.querySelector(`.bar[data-id="${b.dataset.id}"]`)?.focus();
    const prof = document.querySelector(".prof"), top = prof.getBoundingClientRect().top;
    if (top < 0 || top > innerHeight * 0.6) prof.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  });

  function goalies(d) {
    const h = `<h2 class="h cond">Gardiens</h2>`;
    const s = d.stats;
    if (!s || !Array.isArray(s.goalies)) return `<section class="blk white">${h}${errBox("Statistiques des gardiens", d.errors.stats || "données absentes")}</section>`;
    const list = s.goalies.filter((p) => fin(p.gamesPlayed) && p.gamesPlayed > 0).sort((a, b) => b.gamesPlayed - a.gamesPlayed || b.wins - a.wins);
    if (!list.length) return `<section class="blk white">${h}<p class="asof">Aucun match joué pour l’instant.</p></section>`;
    const n = (v) => (fin(v) ? v : "—");
    return `<section class="blk white">${h}<table class="stats gl">
      <thead><tr><th>Gardien</th><th>PJ</th><th>V</th><th>D</th><th>DP</th><th>%ARR</th><th>MOY</th></tr></thead><tbody>
      ${list.map((p) => `<tr><td>${nameCell(d, p)}</td><td>${n(p.gamesPlayed)}</td><td>${n(p.wins)}</td><td>${n(p.losses)}</td><td>${n(p.overtimeLosses)}</td><td class="pts">${pct(p.savePercentage)}</td><td>${gaa(p.goalsAgainstAverage)}</td></tr>`).join("")}
      </tbody></table><p class="asof">V victoires · D défaites · DP défaites en prolongation ou tirs de barrage · %ARR pourcentage d’arrêts · MOY moyenne de buts alloués.</p></section>`;
  }


  const sleeve = `<div class="sleeve" aria-hidden="true"></div>`;
  T.load(Object.keys(SOURCE_LABEL)).then((d) => {
    const parts = [() => header(d), () => leaders(d), () => TB.section(d.injuries, d.roster, Date.now(), d.errors.injuries), () => roster(d), () => sleeve, () => skaters(d), () => goalies(d)];
    document.getElementById("app").innerHTML = T.sections(parts);
    draw();
    const failed = Object.keys(SOURCE_LABEL).filter((n) => d.errors[n]).map((n) => SOURCE_LABEL[n]);
    document.getElementById("foot").innerHTML = T.footer(d.meta, d.errors.meta, failed);
  });
})();
