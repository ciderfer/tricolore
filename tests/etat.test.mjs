// Tests de la logique de surveillance (scripts/etat.mjs). Lancer : node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { failingSince, diagnose, planIssue, issueBody, ISSUE_TITLE, BOT, STALE_MIN, FAIL_MIN } from "../scripts/etat.mjs";

const NOW = Date.parse("2026-10-20T18:00:00Z");
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const ok = { ok: true, url: "x" };
const meta = (over = {}) => ({ updatedAt: ago(5), checkedAt: ago(5), sources: { schedule: ok, standings: ok }, ...over });

test("failingSince garde le début d'une panne qui dure, sinon prend maintenant", () => {
  const now = "2026-10-20T18:00:00.000Z";
  assert.equal(failingSince(undefined, now), now);
  assert.equal(failingSince({ ok: true }, now), now);
  assert.equal(failingSince({ ok: false, since: "2026-10-20T15:00:00.000Z" }, now), "2026-10-20T15:00:00.000Z");
  assert.equal(failingSince({ ok: false }, now), now); // ancien format sans since
});

test("diagnose : données fraîches et sources OK, aucun problème", () => {
  assert.deepEqual(diagnose(meta(), NOW), []);
});

test("diagnose : péremption à partir de 90 min sans vérification", () => {
  assert.deepEqual(diagnose(meta({ checkedAt: ago(STALE_MIN) }), NOW), []); // exactement 90 min : pas encore
  const p = diagnose(meta({ checkedAt: ago(STALE_MIN + 1) }), NOW);
  assert.equal(p.length, 1);
  assert.match(p[0], /^Données non vérifiées depuis 91 min/);
  assert.match(p[0], /\(dernière vérification : 20 octobre 2026 à 12 h 29, heure de l’Est\)\.$/); // 16 h 29 UTC = 12 h 29 à Montréal (HAE)
});

test("diagnose : sans checkedAt, se rabat sur updatedAt; sans aucune heure, le signale", () => {
  assert.equal(diagnose({ updatedAt: ago(200), sources: {} }, NOW).length, 1);
  assert.deepEqual(diagnose({ sources: {} }, NOW), ["meta.json ne contient aucune heure de vérification."]);
});

test("diagnose : une source en échec n'est signalée qu'après 2 h", () => {
  const recent = meta({ sources: { schedule: { ok: false, error: "HTTP 503", since: ago(FAIL_MIN) } } });
  assert.deepEqual(diagnose(recent, NOW), []);
  const long = diagnose(meta({ sources: { schedule: { ok: false, error: "HTTP 503", since: ago(FAIL_MIN + 30) } } }), NOW);
  assert.equal(long.length, 1);
  assert.match(long[0], /^Source « schedule » en échec depuis 150 min .*: HTTP 503\.$/);
});

test("diagnose : une source en échec sans since (ancien meta.json) n'est pas signalée", () => {
  assert.deepEqual(diagnose(meta({ sources: { schedule: { ok: false, error: "HTTP 503" } } }), NOW), []);
});

test("diagnose : meta.json illisible", () => {
  assert.deepEqual(diagnose(null, NOW, "HTTP 404"), ["meta.json du site illisible (HTTP 404)."]);
});

const issue = (n, extra = {}) => ({ number: n, title: ISSUE_TITLE, user: { login: BOT }, ...extra });

test("planIssue : ouvre une seule issue, sans doublon", () => {
  assert.deepEqual(planIssue(["x"], []), { action: "create" });
  assert.deepEqual(planIssue(["x"], [issue(5)]), { action: "update", number: 5 });
});

test("planIssue : ferme l'issue au retour à la normale, sinon ne fait rien", () => {
  assert.deepEqual(planIssue([], [issue(5)]), { action: "close", number: 5 });
  assert.deepEqual(planIssue([], []), { action: "none" });
});

test("planIssue : ignore les PR, les autres titres et les issues d'une personne", () => {
  const others = [
    issue(17, { pull_request: { url: "x" } }),
    { number: 3, title: "Autre chose", user: { login: BOT } },
    { number: 4, title: ISSUE_TITLE, user: { login: "ciderfer" } },
  ];
  assert.deepEqual(planIssue(["x"], others), { action: "create" });
  assert.deepEqual(planIssue([], others), { action: "none" });
});

test("issueBody : mentionne Frederic et liste les problèmes", () => {
  const b = issueBody(["Problème A", "Problème B"], NOW, "https://ciderfer.github.io/tricolore");
  assert.match(b, /^@ciderfer/);
  assert.match(b, /^- Problème A$/m);
  assert.match(b, /^- Problème B$/m);
  assert.match(b, /https:\/\/ciderfer\.github\.io\/tricolore\/data\/meta\.json/);
});
