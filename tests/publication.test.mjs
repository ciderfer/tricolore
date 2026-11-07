// Tests de la publication sans données dans Git (scripts/publication.mjs, .github/workflows/data.yml).
// Lancer : node --test tests/*.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, essentials } from "../scripts/publication.mjs";

const ROOT = new URL("../", import.meta.url);
const SCRIPT = new URL("../scripts/publication.mjs", import.meta.url).pathname;
const made = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), "tricolore-")); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

// Un petit site construit : code, données essentielles, une fiche de joueur.
function site(over = {}) {
  const dir = temp();
  const files = {
    "index.html": "<script src=\"app.js?v=abcd1234\"></script>",
    "app.js": "/* code */",
    "data/meta.json": JSON.stringify({ updatedAt: "2026-11-07T12:00:00Z", checkedAt: "2026-11-07T12:00:00Z", sources: {} }),
    "data/schedule.json": JSON.stringify({ games: [{ id: 1 }] }),
    "data/joueurs/8480018.json": "{}",
    ...over,
  };
  for (const [f, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}
const copy = (dir) => { const d = temp(); cpSync(dir, d, { recursive: true }); return d; };

test("cache absent (premier passage) : on publie tout", () => {
  const r = decide("/chemin/inexistant", site(), "workflow_dispatch");
  assert.equal(r.publish, true);
  assert.match(r.why, /^5 fichier\(s\) changé\(s\)/);
});

test("cache présent, rien de changé : pas de publication (minuterie, horaire, sur demande)", () => {
  const s = site();
  for (const event of ["workflow_dispatch", "schedule"]) {
    const r = decide(copy(s), s, event);
    assert.equal(r.publish, false);
    assert.equal(r.why, "aucun changement depuis la dernière publication");
  }
});

test("cache présent, données changées (checkedAt aux 45 min) : on publie, avec la liste des fichiers", () => {
  const published = site();
  const r = decide(published, site({ "data/meta.json": JSON.stringify({ checkedAt: "2026-11-07T12:45:00Z" }) }), "schedule");
  assert.deepEqual(r, { publish: true, why: "1 fichier(s) changé(s) : data/meta.json" });
});

test("code changé sans push (push remplacé dans la file) : le passage suivant le publie", () => {
  const r = decide(site(), site({ "app.js": "/* nouveau code */" }), "workflow_dispatch");
  assert.deepEqual(r, { publish: true, why: "1 fichier(s) changé(s) : app.js" });
});

test("fiche d'un joueur parti : le fichier retiré compte comme un changement", () => {
  const r = decide(site(), site({ "data/joueurs/8480018.json": null }), "schedule");
  assert.deepEqual(r, { publish: true, why: "1 fichier(s) changé(s) : data/joueurs/8480018.json" });
});

test("push sur main sans changement : on publie quand même", () => {
  const s = site();
  assert.deepEqual(decide(copy(s), s, "push"), { publish: true, why: "push sur main (0 fichier(s) changé(s))" });
});

test("données essentielles absentes ou illisibles : erreur, rien de publié, même sur un push", () => {
  const cases = [
    [{ "data/schedule.json": null }, "data/schedule.json absent"],
    [{ "data/meta.json": null }, "data/meta.json absent"],
    [{ "data/meta.json": "{pas du json" }, "data/meta.json illisible"],
    [{ "data/meta.json": "{}" }, "data/meta.json sans checkedAt"],
    [{ "data/schedule.json": "{}" }, "data/schedule.json sans liste de matchs"],
  ];
  for (const [over, problem] of cases) {
    assert.deepEqual(essentials(site(over)), [problem]);
    const r = decide("/chemin/inexistant", site(over), "push");
    assert.equal(r.publish, false);
    assert.equal(r.error, `Données essentielles manquantes : ${problem}. Rien n'est publié.`);
  }
  assert.deepEqual(essentials(temp()), ["data/meta.json absent", "data/schedule.json absent"]);
});

test("en ligne de commande : publier=true|false dans GITHUB_OUTPUT, code 1 si une donnée essentielle manque", () => {
  const out = join(temp(), "sortie");
  const run = (published, s, event) => spawnSync(process.execPath, [SCRIPT, published, s, event], { env: { ...process.env, GITHUB_OUTPUT: out }, encoding: "utf8" });
  const s = site();
  let r = run(copy(s), s, "schedule");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^Pas de publication : aucun changement/);
  r = run("/chemin/inexistant", s, "schedule");
  assert.equal(r.status, 0);
  assert.equal(readFileSync(out, "utf8"), "publier=false\npublier=true\n");
  r = run(copy(s), site({ "data/schedule.json": null }), "push");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /data\/schedule\.json absent/);
  assert.equal(readFileSync(out, "utf8"), "publier=false\npublier=true\n", "rien d'écrit en cas d'échec");
});

// ---- Le workflow lui-même (lu comme du texte : aucune dépendance YAML) ----
const WF = readFileSync(new URL(".github/workflows/data.yml", ROOT), "utf8");
const at = (s) => { const i = WF.indexOf(s); assert.ok(i >= 0, `${s} dans data.yml`); return i; };

test("data.yml : un seul workflow, déclencheurs et nom gardés pour le Worker", () => {
  assert.ok(!existsSync(new URL(".github/workflows/pages.yml", ROOT)), "pages.yml remplacé par data.yml");
  for (const s of ["workflow_dispatch:", 'cron: "8,38 * * * *"', "push:\n    branches: [main]"]) at(s);
  assert.match(readFileSync(new URL("worker/index.js", ROOT), "utf8"), /actions\/workflows\/data\.yml\/dispatches/);
});

test("data.yml : aucun droit d'écriture sur le repo, un passage à la fois", () => {
  assert.doesNotMatch(WF, /contents:\s*write/);
  assert.doesNotMatch(WF, /git (commit|push)/);
  at("permissions:\n  contents: read");
  at("concurrency:\n  group: donnees-lnh\n  cancel-in-progress: false");
});

test("data.yml : cache lu avant les scripts, décision avant publication, cache écrit après la publication", () => {
  const order = ["actions/cache/restore@", "rm -rf data && cp -r _publie/data data", "node scripts/fetch-data.mjs", "node scripts/fetch-injuries.mjs",
    "Préparer le site", "node scripts/publication.mjs _publie _site", "upload-pages-artifact@", "\n  publier:\n", "deploy-pages@", "download-artifact@", "actions/cache/save@"];
  const pos = order.map(at);
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, "étapes dans l'ordre");
  const keys = [...WF.matchAll(/key: (site-publie-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\})/g)];
  assert.equal(keys.length, 2, "même clé à la lecture et à l'écriture");
  at("restore-keys: site-publie-");
  at("if: needs.donnees.outputs.publier == 'true'");
});

test("data.yml : même site qu'avant (fichiers statiques, données, ?v= des JS et CSS)", () => {
  at("cp -r *.html *.js *.css fonts data manifest.webmanifest icons robots.txt sitemap.xml _site/");
  at("V=$(cat *.js *.css | sha256sum | cut -c1-8)");
  at("grep -oE '\"[a-z]+\\.(js|css)\\?v=[0-9a-f]{8}\"' _site/index.html");
});

test("data/ hors de Git, recréé en local; retour en arrière documenté", () => {
  assert.equal(execFileSync("git", ["ls-files", "data"], { cwd: ROOT, encoding: "utf8" }), "");
  assert.match(readFileSync(new URL(".gitignore", ROOT), "utf8"), /^\/data\/$/m);
  const doc = readFileSync(new URL("docs/proposition-donnees-hors-git.md", ROOT), "utf8");
  assert.match(doc, /^## Retour en arrière$/m);
  assert.match(readFileSync(new URL("README.md", ROOT), "utf8"), /docs\/proposition-donnees-hors-git\.md/);
});
