// Tricolore — blessés du Canadien, tirés de l'API publique non officielle d'ESPN (sans clé).
// Node 20+, aucune dépendance. Lancé par .github/workflows/data.yml après fetch-data.mjs.
//
// - data/injuries.json : { source, url, fetchedAt, updatedAt, players: [...] }
//   fetchedAt = dernière lecture réussie d'ESPN; updatedAt = dernier changement de la liste.
// - Champs structurés seulement (nom, position, statut, type de blessure, date de retour estimée,
//   date de la fiche ESPN). Jamais les commentaires rédigés (longComment, shortComment).
// - En cas d'échec (réseau, HTTP, format inattendu, CH absent de la réponse), le fichier devient
//   { players: null, error } et le script se termine sans erreur : la page affiche « données indisponibles »,
//   jamais « Aucun blessé signalé » sans le savoir.
// - Si la liste n'a pas changé et que fetchedAt a moins de 45 min, rien n'est réécrit (pas de commit).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const URL_ESPN = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries";
export const TEAM_ID = "10"; // Canadiens de Montréal chez ESPN
export const HEARTBEAT_MS = 45 * 60 * 1000;

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const day = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// Réponse brute d'ESPN → liste des blessés du CH (champs structurés). Lance une erreur si le format est inattendu.
// ESPN omet les équipes sans blessé, mais aussi parfois des équipes par erreur : CH absent = on ne sait pas (erreur).
export function extract(raw) {
  if (!raw || !Array.isArray(raw.injuries) || !raw.injuries.length) throw new Error("format inattendu (injuries absent)");
  const team = raw.injuries.find((t) => String(t?.id) === TEAM_ID);
  if (!team) throw new Error("CH absent de la réponse ESPN");
  if (!Array.isArray(team.injuries)) throw new Error("format inattendu (équipe sans liste)");
  const out = team.injuries
    .map((i) => ({
      name: str(i?.athlete?.displayName),
      firstName: str(i?.athlete?.firstName),
      lastName: str(i?.athlete?.lastName),
      pos: str(i?.athlete?.position?.abbreviation),
      status: str(i?.status),
      type: str(i?.details?.type),
      returnDate: day(i?.details?.returnDate),
      updated: str(i?.date),
    }))
    .filter((p) => p.name && p.lastName && p.status);
  if (team.injuries.length && !out.length) throw new Error("format inattendu (fiches illisibles)");
  return out;
}

// Nouveau contenu du fichier, ou null s'il n'y a rien à réécrire. Échec : players null et error (la raison).
export function nextFile(old, players, now, error = null) {
  const same = JSON.stringify(old?.players) === JSON.stringify(players) && (old?.error ?? null) === error;
  const last = Date.parse(old?.fetchedAt || 0) || 0;
  if (same && now - last <= HEARTBEAT_MS) return null;
  return {
    source: "ESPN",
    url: URL_ESPN,
    fetchedAt: now.toISOString(),
    updatedAt: same && old?.updatedAt ? old.updatedAt : now.toISOString(),
    players,
    ...(error ? { error } : {}),
  };
}

async function main() {
  const FILE = new URL("../data/injuries.json", import.meta.url);
  const old = JSON.parse(await readFile(FILE, "utf8").catch(() => "null"));
  try {
    const res = await fetch(URL_ESPN, {
      headers: { "user-agent": "tricolore (site de partisan; github.com/ciderfer/tricolore)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const players = extract(await res.json());
    const next = nextFile(old, players, new Date());
    if (next) await writeFile(FILE, JSON.stringify(next, null, 1) + "\n");
    console.log(`Blessés (ESPN) : ${players.length}${next ? "" : " (aucun changement)"}.`);
  } catch (err) {
    const error = String(err?.message || err);
    const next = nextFile(old, null, new Date(), error);
    if (next) await writeFile(FILE, JSON.stringify(next, null, 1) + "\n");
    console.log(`ÉCHEC blessés ESPN (${error}) : données indisponibles.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
