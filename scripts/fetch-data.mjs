// Tricolore — récupère les données publiques de l'API LNH et les écrit dans data/.
// Node 20+, aucune dépendance. Utilisé localement et par .github/workflows/data.yml.
//
// - data/<source>.json : réponse brute de l'API (seul le champ volatil
//   standings.standingsDateTimeUtc est retiré pour éviter un commit à chaque exécution;
//   les liens vers les photos des joueurs (headshot) de roster et stats sont aussi retirés,
//   le site n'affiche aucune photo).
// - data/meta.json : updatedAt (dernière modification des données), checkedAt (dernière
//   vérification réussie, rafraîchie au moins aux 45 min pour que la page détecte un arrêt)
//   et état de chaque source.
// - Si une source échoue, son ancien fichier est conservé, mais meta.json la marque
//   en échec : la page affiche alors un message d'erreur au lieu de données périmées.
// - Si rien n'a changé (données et état des sources) et que checkedAt a moins de 45 min,
//   aucun fichier n'est réécrit (donc aucun commit).
// - data/canadiens.ics : calendrier à s'abonner (voir scripts/ics.mjs), réécrit seulement si un match change.
// - data/news.json : manchettes (titre, source, date, lien seulement), voir scripts/news.mjs.
//   L'état de chaque source de nouvelles est noté dans meta.json (champ news).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fetchNews } from "./news.mjs";
import { buildIcs, withoutStamps } from "./ics.mjs";

const BASE = "https://api-web.nhle.com/v1";
const SOURCES = {
  schedule: "/club-schedule-season/MTL/now",
  scoreboard: "/scoreboard/MTL/now",
  standings: "/standings/now",
  roster: "/roster/MTL/current",
  stats: "/club-stats/MTL/now",
};
const DIR = new URL("../data/", import.meta.url);

const readText = (name) => readFile(new URL(name, DIR), "utf8").catch(() => null);

await mkdir(DIR, { recursive: true });
const oldMeta = JSON.parse((await readText("meta.json")) || "null");
const sources = {};
let changed = false;

for (const [name, path] of Object.entries(SOURCES)) {
  try {
    const res = await fetch(BASE + path, {
      redirect: "follow",
      headers: { "user-agent": "tricolore (site de partisan; github.com/ciderfer/tricolore)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (name === "standings") delete json.standingsDateTimeUtc;
    if (name === "roster" || name === "stats") for (const list of Object.values(json)) if (Array.isArray(list)) for (const p of list) delete p.headshot;
    const text = JSON.stringify(json);
    if (text !== (await readText(`${name}.json`))) {
      await writeFile(new URL(`${name}.json`, DIR), text);
      changed = true;
    }
    sources[name] = { ok: true, url: res.url };
  } catch (err) {
    sources[name] = { ok: false, url: BASE + path, error: String(err?.message || err) };
  }
}

// Calendrier iCalendar : seulement si le calendrier a été lu avec succès à cette exécution.
let icsCount = null;
if (sources.schedule?.ok) {
  try {
    const { text, count } = buildIcs(JSON.parse(await readText("schedule.json")));
    icsCount = count;
    if (withoutStamps(text) !== withoutStamps(await readText("canadiens.ics"))) {
      await writeFile(new URL("canadiens.ics", DIR), text);
      changed = true;
    }
  } catch (err) { console.log(`ÉCHEC calendrier .ics (${err?.message || err})`); }
}

// Nouvelles : les noms des joueurs actuels aident à filtrer les flux hockey.
let rosterNames = [];
try {
  const roster = await (await fetch(BASE + "/roster/MTL/current", { redirect: "follow", signal: AbortSignal.timeout(20_000) })).json();
  rosterNames = ["forwards", "defensemen", "goalies"].flatMap((k) => roster[k] || []).map((p) => p.lastName?.default);
} catch { /* filtre sur les mots de l'équipe seulement */ }
const news = await fetchNews(rosterNames);
const newsOk = Object.values(news.status).some((s) => s.ok);
if (newsOk) {
  const text = JSON.stringify({ items: news.items });
  if (text !== (await readText("news.json"))) { await writeFile(new URL("news.json", DIR), text); changed = true; }
}
const newsStatus = Object.fromEntries(Object.entries(news.status).map(([k, v]) => [k, v.ok ? { ok: true, name: v.name } : v]));

if (JSON.stringify(sources) !== JSON.stringify(oldMeta?.sources)) changed = true;
if (JSON.stringify(newsStatus) !== JSON.stringify(oldMeta?.news)) changed = true;
const now = new Date();
const HEARTBEAT_MS = 45 * 60 * 1000;
const lastCheck = Date.parse(oldMeta?.checkedAt || oldMeta?.updatedAt || 0) || 0;
const anyOk = Object.values(sources).some((s) => s.ok);
const heartbeat = anyOk && now - lastCheck > HEARTBEAT_MS;
if (changed || heartbeat) {
  const meta = {
    updatedAt: changed ? now.toISOString() : oldMeta?.updatedAt || now.toISOString(),
    checkedAt: anyOk ? now.toISOString() : oldMeta?.checkedAt || null,
    sources,
    news: newsStatus,
  };
  await writeFile(new URL("meta.json", DIR), JSON.stringify(meta, null, 2) + "\n");
}
console.log(changed ? "Données modifiées." : heartbeat ? "Aucun changement (vérification notée)." : "Aucun changement.");
for (const [n, s] of Object.entries(sources)) console.log(`${s.ok ? "OK   " : "ÉCHEC"} ${n} ${s.url}${s.error ? ` (${s.error})` : ""}`);
for (const [n, s] of Object.entries(newsStatus)) console.log(`${s.ok ? "OK   " : "ÉCHEC"} nouvelles/${n}${s.error ? ` (${s.error})` : ""}`);
console.log(`${news.items.length} manchettes retenues.`);
if (icsCount !== null) console.log(`${icsCount} matchs dans canadiens.ics.`);
if (Object.values(sources).every((s) => !s.ok)) process.exitCode = 1;
