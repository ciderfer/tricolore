// Tricolore — état des données : logique pure (sans réseau ni fichiers), testée par tests/etat.test.mjs.
// Utilisée par scripts/fetch-data.mjs (début d'une panne) et scripts/surveillance.mjs (alerte par issue GitHub).

export const STALE_MIN = 90; // la page affiche déjà « données périmées » après 90 min sans vérification
export const FAIL_MIN = 120; // une source en échec depuis plus de 2 h est une panne, pas un raté passager
export const ISSUE_TITLE = "Tricolore : données en panne";
export const BOT = "github-actions[bot]";
// Expiration du GH_TOKEN du Worker (minuit, heure de Montréal). Après l'avoir renouvelé, mettre la nouvelle date ici.
export const GH_TOKEN_EXPIRES = "2027-01-17T00:00:00-05:00";
export const TOKEN_WARN_DAYS = 14; // l'alerte part 14 jours avant

// Début d'une panne : on garde la date déjà notée si la source était déjà en échec, sinon c'est maintenant.
export function failingSince(old, nowIso) {
  return old && old.ok === false && old.since ? old.since : nowIso;
}

const fStamp = new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Toronto", dateStyle: "long", timeStyle: "short" });
const when = (ms) => `${fStamp.format(new Date(ms))}, heure de l’Est`;
const minutes = (ms) => Math.floor(ms / 60_000);

// Problèmes visibles dans meta.json (tel que publié sur le site). meta : objet lu, ou null si illisible.
// fetchError : message si meta.json n'a pas pu être lu. Retourne une liste de phrases (vide = tout va bien).
export function diagnose(meta, now, fetchError = null) {
  const problems = tokenProblems(now);
  if (fetchError || !meta) return [...problems, `meta.json du site illisible (${fetchError || "contenu vide"}).`];
  const checked = Date.parse(meta.checkedAt || meta.updatedAt || "");
  if (!Number.isFinite(checked)) problems.push("meta.json ne contient aucune heure de vérification.");
  else if (now - checked > STALE_MIN * 60_000)
    problems.push(`Données non vérifiées depuis ${minutes(now - checked)} min (dernière vérification : ${when(checked)}).`);
  for (const [name, s] of Object.entries(meta.sources || {})) {
    if (s?.ok !== false) continue;
    const since = Date.parse(s.since || ""); // ancienne version de meta.json : durée inconnue, on attend le prochain passage
    if (Number.isFinite(since) && now - since > FAIL_MIN * 60_000)
      problems.push(`Source « ${name} » en échec depuis ${minutes(now - since)} min (depuis le ${when(since)}) : ${s.error || "erreur inconnue"}.`);
  }
  return problems;
}

// Le GH_TOKEN expire sans avertir : la minuterie du Worker échoue en silence, et l'horaire GitHub cache la panne.
function tokenProblems(now, expires = GH_TOKEN_EXPIRES) {
  const end = Date.parse(expires);
  const days = Math.ceil((end - now) / 86_400_000);
  if (days > TOKEN_WARN_DAYS) return [];
  const fix = "Renouveler le jeton (README, section « Worker Cloudflare »), puis mettre la nouvelle date dans GH_TOKEN_EXPIRES (scripts/etat.mjs).";
  if (now >= end) return [`Le GH_TOKEN du Worker a expiré le ${when(end)}. ${fix}`];
  return [`Le GH_TOKEN du Worker expire le ${when(end)}, dans ${days} jour${days > 1 ? "s" : ""}. ${fix}`];
}

// Que faire de l'issue d'alerte. issues : issues ouvertes du dépôt (format de l'API GitHub).
// Une seule issue à la fois : on ne crée rien si elle est déjà ouverte, on la ferme quand tout va bien.
export function planIssue(problems, issues) {
  const open = (issues || []).find((i) => !i.pull_request && i.title === ISSUE_TITLE && i.user?.login === BOT) || null;
  if (problems.length) return open ? { action: "update", number: open.number } : { action: "create" };
  return open ? { action: "close", number: open.number } : { action: "none" };
}

export function issueBody(problems, now, site) {
  return [
    "@ciderfer, la surveillance automatique a détecté un problème sur les données du site.",
    "",
    ...problems.map((p) => `- ${p}`),
    "",
    `Vérifié le ${when(now)} à partir de ${site}/data/meta.json.`,
    "",
    "Pistes : la tâche « Données LNH » (onglet Actions), le Worker Cloudflare et son GH_TOKEN, l’API de la LNH.",
    "Cette issue se ferme d’elle-même quand tout revient à la normale.",
  ].join("\n");
}
