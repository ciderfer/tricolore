// Tricolore — faut-il publier le site? Étape de .github/workflows/data.yml, testée par tests/publication.test.mjs.
// Les données ne sont plus dans Git : le cache GitHub Actions garde le dernier site publié (_publie/). On compare
// le nouveau _site à ce site-là, fichier par fichier : on publie si un fichier diffère (données ou code), ou sur un push.
// Avant tout, meta.json et schedule.json doivent être lisibles : sinon on échoue, et le site en ligne reste tel quel.
// Usage : node scripts/publication.mjs <site publié> <nouveau site> <événement>; écrit publier=true|false dans $GITHUB_OUTPUT.
import { readFileSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

// Empreinte de chaque fichier d'un dossier (chemin relatif → sha256). Dossier absent (cache vide) : {}.
export function fingerprint(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const file = join(e.parentPath, e.name);
    out[relative(dir, file)] = createHash("sha256").update(readFileSync(file)).digest("hex");
  }
  return out;
}

// Fichiers ajoutés, modifiés ou retirés entre deux empreintes.
export function changes(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => before[f] !== after[f]).sort();
}

// Données sans lesquelles l'accueil n'affiche rien : la liste des problèmes (vide = on peut publier).
export function essentials(site) {
  const problems = [];
  const read = (name) => {
    try { return JSON.parse(readFileSync(join(site, "data", name), "utf8")); }
    catch (e) { problems.push(`data/${name} ${e.code === "ENOENT" ? "absent" : "illisible"}`); return null; }
  };
  const meta = read("meta.json"), schedule = read("schedule.json");
  if (meta && !Date.parse(meta.checkedAt || "")) problems.push("data/meta.json sans checkedAt");
  if (schedule && !Array.isArray(schedule.games)) problems.push("data/schedule.json sans liste de matchs");
  return problems;
}

export function decide(published, site, event) {
  const problems = essentials(site);
  if (problems.length) return { publish: false, error: `Données essentielles manquantes : ${problems.join(", ")}. Rien n'est publié.` };
  const changed = changes(fingerprint(published), fingerprint(site));
  if (event === "push") return { publish: true, why: `push sur main (${changed.length} fichier(s) changé(s))` };
  if (changed.length) return { publish: true, why: `${changed.length} fichier(s) changé(s) : ${changed.slice(0, 10).join(", ")}${changed.length > 10 ? "…" : ""}` };
  return { publish: false, why: "aucun changement depuis la dernière publication" };
}

if (process.argv[1]?.endsWith("publication.mjs")) {
  const [published, site, event] = process.argv.slice(2);
  const r = decide(published, site, event);
  if (r.error) { console.error(r.error); process.exit(1); }
  console.log(`${r.publish ? "Publication" : "Pas de publication"} : ${r.why}.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publier=${r.publish}\n`);
}
