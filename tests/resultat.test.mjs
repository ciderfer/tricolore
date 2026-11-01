// Tests du résultat d'un match fini (T.outcome dans commun.js, utilisé par l'accueil et le calendrier). Lancer : node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { window: {}, location: { search: "" }, URLSearchParams, console };
vm.runInNewContext(readFileSync(new URL("../commun.js", import.meta.url), "utf8"), ctx);
const { outcome } = ctx.window.T;

// Match fini; le CH à domicile ou chez l'adversaire, lastPeriodType "REG", "OT" ou "SO".
const game = (mtl, opp, x, home = true) => {
  const ch = { abbrev: "MTL", score: mtl }, other = { abbrev: "PIT", score: opp };
  return { gameState: "OFF", homeTeam: home ? ch : other, awayTeam: home ? other : ch, gameOutcome: { lastPeriodType: x } };
};
const res = (g) => ({ ...outcome(g) }); // objet du bac à sable vm -> objet ordinaire pour deepEqual

test("défaite en prolongation ou en tirs de barrage : DP, chez nous comme à l'étranger", () => {
  assert.deepEqual(res(game(5, 6, "OT", false)), { code: "DP", extra: "Prol.", label: "Défaite en prolongation" });
  assert.deepEqual(res(game(2, 3, "SO")), { code: "DP", extra: "TB", label: "Défaite en tirs de barrage" });
});

test("défaite en temps réglementaire : D, sans mention", () => {
  assert.deepEqual(res(game(1, 4, "REG")), { code: "D", extra: "", label: "Défaite" });
  assert.deepEqual(res(game(1, 4, "REG", false)), { code: "D", extra: "", label: "Défaite" });
});

test("victoire : V, avec la mention de prolongation ou de tirs de barrage s'il y a lieu", () => {
  assert.deepEqual(res(game(4, 1, "REG", false)), { code: "V", extra: "", label: "Victoire" });
  assert.deepEqual(res(game(3, 2, "OT")), { code: "V", extra: "Prol.", label: "Victoire en prolongation" });
  assert.deepEqual(res(game(4, 3, "SO", false)), { code: "V", extra: "TB", label: "Victoire en tirs de barrage" });
});
