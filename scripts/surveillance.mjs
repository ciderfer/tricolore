// Tricolore — surveillance des données (lancé par .github/workflows/surveillance.yml).
// Lit meta.json sur le site publié; s'il y a un problème (voir diagnose dans etat.mjs), ouvre une issue GitHub
// (Frederic reçoit un courriel), la met à jour en silence tant que le problème dure, et la ferme au retour à la normale.
// Sans GITHUB_TOKEN (essai en local) : affiche seulement ce qui serait fait. Node 20+, aucune dépendance.
import { diagnose, planIssue, issueBody, ISSUE_TITLE, BOT } from "./etat.mjs";

const SITE = process.env.SITE || "https://ciderfer.github.io/tricolore";
const REPO = process.env.GITHUB_REPOSITORY || "ciderfer/tricolore";
const TOKEN = process.env.GITHUB_TOKEN || "";
const API = process.env.GITHUB_API_URL || "https://api.github.com"; // fourni par GitHub Actions; remplaçable pour un essai local

// Trois essais espacés : un raté passager de GitHub Pages ne doit pas déclencher d'alerte.
async function readMeta() {
  let last = "";
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 15_000));
    try {
      const r = await fetch(`${SITE}/data/meta.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!r.ok) { last = `HTTP ${r.status}`; continue; }
      return { meta: await r.json(), error: null };
    } catch (e) { last = e.name === "TimeoutError" ? "délai dépassé" : String(e.message || e); }
  }
  return { meta: null, error: last };
}

async function gh(method, path, body) {
  const r = await fetch(`${API}/repos/${REPO}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "tricolore-surveillance" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${path} : HTTP ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const now = Date.now();
const { meta, error } = await readMeta();
const problems = diagnose(meta, now, error);
console.log(problems.length ? `Problèmes :\n- ${problems.join("\n- ")}` : "Tout va bien.");

if (!TOKEN) {
  console.log("Essai sans GITHUB_TOKEN : aucune issue lue ni modifiée.");
} else {
  const issues = await gh("GET", `/issues?state=open&creator=${encodeURIComponent(BOT)}&per_page=100`);
  const plan = planIssue(problems, issues);
  if (plan.action === "create") {
    const i = await gh("POST", "/issues", { title: ISSUE_TITLE, body: issueBody(problems, now, SITE) });
    console.log(`Issue #${i.number} ouverte.`);
  } else if (plan.action === "update") {
    // Modifier le texte n'envoie pas de courriel : l'issue reste à jour sans en envoyer un à chaque passage.
    await gh("PATCH", `/issues/${plan.number}`, { body: issueBody(problems, now, SITE) });
    console.log(`Issue #${plan.number} déjà ouverte : texte mis à jour.`);
  } else if (plan.action === "close") {
    await gh("POST", `/issues/${plan.number}/comments`, { body: "Retour à la normale : les données sont de nouveau vérifiées et toutes les sources répondent." });
    await gh("PATCH", `/issues/${plan.number}`, { state: "closed", state_reason: "completed" });
    console.log(`Issue #${plan.number} fermée.`);
  } else {
    console.log("Aucune issue à ouvrir ni à fermer.");
  }
}
