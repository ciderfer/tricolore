// Tests du code de résultat (T.outcome dans commun.js), partagé par l'accueil et le calendrier. Lancer : node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { window: {}, location: { search: "" }, URLSearchParams, console };
vm.runInNewContext(readFileSync(new URL("../commun.js", import.meta.url), "utf8"), ctx);
const { outcome } = ctx.window.T;
const r = (us, them, x) => ({ ...outcome({ score: us }, { score: them }, x) });

test("défaite en prolongation ou en tirs de barrage : DP", () => {
  assert.deepEqual(r(3, 4, "OT"), { code: "DP", extra: "Prol." }); // SJS 4, MTL 3 en prolongation (20 oct. 2026)
  assert.deepEqual(r(3, 4, "SO"), { code: "DP", extra: "TB" });
});

test("victoire et défaite en temps réglementaire", () => {
  assert.deepEqual(r(4, 3, "OT"), { code: "V", extra: "Prol." });
  assert.deepEqual(r(1, 0, "SO"), { code: "V", extra: "TB" });
  assert.deepEqual(r(2, 5, "REG"), { code: "D", extra: "" });
  assert.deepEqual(r(5, 2, undefined), { code: "V", extra: "" });
});
