// Tricolore — récupère les données publiques de l'API LNH et les écrit dans data/.
// Node 20+, aucune dépendance. Utilisé localement et par .github/workflows/data.yml.
//
// - data/<source>.json : réponse brute de l'API (seul le champ volatil
//   standings.standingsDateTimeUtc est retiré pour éviter un commit à chaque exécution).
// - data/meta.json : heure de la dernière modification et état de chaque source.
// - Si une source échoue, son ancien fichier est conservé, mais meta.json la marque
//   en échec : la page affiche alors un message d'erreur au lieu de données périmées.
// - Si rien n'a changé (données et état des sources), aucun fichier n'est réécrit.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const BASE = "https://api-web.nhle.com/v1";
const SOURCES = {
  schedule: "/club-schedule-season/MTL/now",
  scoreboard: "/scoreboard/MTL/now",
  standings: "/standings/now",
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

if (JSON.stringify(sources) !== JSON.stringify(oldMeta?.sources)) changed = true;
if (changed) {
  await writeFile(new URL("meta.json", DIR), JSON.stringify({ updatedAt: new Date().toISOString(), sources }, null, 2) + "\n");
}
console.log(changed ? "Données modifiées." : "Aucun changement.");
for (const [n, s] of Object.entries(sources)) console.log(`${s.ok ? "OK   " : "ÉCHEC"} ${n} ${s.url}${s.error ? ` (${s.error})` : ""}`);
if (Object.values(sources).every((s) => !s.ok)) process.exitCode = 1;
