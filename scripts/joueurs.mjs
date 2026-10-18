// Tricolore — fiches des joueurs de l'alignement actuel : data/joueurs/<id>.json.
// Source : /v1/player/<id>/landing (API publique de la LNH), pour chaque joueur de data/roster.json.
// On ne garde que les champs affichés (aucune photo : headshot, heroImage, etc. sont retirés),
// et chaque fichier n'est réécrit que si son contenu change. Les fiches des joueurs qui ne sont
// plus dans l'alignement sont supprimées. Un joueur en échec garde son ancien fichier, mais il est
// noté dans meta.json (champ joueurs.failed) et la page l'indique.
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";

const BASE = "https://api-web.nhle.com/v1";
const UA = "tricolore (site de partisan; github.com/ciderfer/tricolore)";
const KEEP = ["playerId", "firstName", "lastName", "sweaterNumber", "position", "shootsCatches", "birthDate", "birthCity",
  "birthStateProvince", "birthCountry", "heightInCentimeters", "weightInKilograms", "heightInInches", "weightInPounds",
  "currentTeamAbbrev", "isActive"];

export function trimPlayer(p, season) {
  const out = {};
  for (const k of KEEP) if (p[k] !== undefined) out[k] = p[k];
  out.season = season;
  // Saison en cours, LNH seulement (une ligne par équipe et par type de match).
  out.seasonTotals = (p.seasonTotals || []).filter((s) => s.leagueAbbrev === "NHL" && s.season === season)
    .map(({ teamName, teamPlaceNameWithPreposition, ...s }) => s);
  out.last5Games = p.last5Games || [];
  out.careerTotals = p.careerTotals || null;
  return out;
}

export async function fetchPlayers(dir, roster, season) {
  const ids = ["forwards", "defensemen", "goalies"].flatMap((k) => roster?.[k] || []).map((p) => p.id).filter((id) => /^\d{7}$/.test(String(id)));
  await mkdir(dir, { recursive: true });
  let changed = false;
  const failed = [];
  const queue = [...ids];
  async function worker() {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const r = await fetch(`${BASE}/player/${id}/landing`, { redirect: "follow", headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const p = await r.json();
        if (p.playerId !== id) throw new Error("réponse inattendue");
        const text = JSON.stringify(trimPlayer(p, season));
        const file = new URL(`${id}.json`, dir);
        const old = await readFile(file, "utf8").catch(() => null);
        if (text !== old) { await writeFile(file, text); changed = true; }
      } catch (err) { failed.push({ id, error: String(err?.message || err) }); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  // Retirer les fiches des joueurs qui ne sont plus dans l'alignement.
  if (ids.length) {
    for (const f of await readdir(dir)) {
      const m = /^(\d{7})\.json$/.exec(f);
      if (m && !ids.includes(Number(m[1]))) { await unlink(new URL(f, dir)); changed = true; }
    }
  }
  failed.sort((a, b) => a.id - b.id);
  return { changed, status: { ok: failed.length < ids.length, count: ids.length - failed.length, failed } };
}
