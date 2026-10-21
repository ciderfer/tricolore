// Tests du dernier but (T.lastGoal dans commun.js, chargé tel quel dans un bac à sable). Lancer : node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { window: {}, location: { search: "" }, URLSearchParams, console };
vm.runInNewContext(readFileSync(new URL("../commun.js", import.meta.url), "utf8"), ctx);
const { lastGoal } = ctx.window.T;

const REG = (n) => ({ number: n, periodType: "REG", maxRegulationPeriods: 3 });
const OT = (n) => ({ number: n, periodType: "OT", maxRegulationPeriods: 3 });
const goal = (last, n, team, time, extra = {}) => ({ eventId: `${last}-${time}`, lastName: { default: last }, name: { default: `X. ${last}` },
  goalsToDate: n, teamAbbrev: { default: team }, timeInPeriod: time, strength: "ev", goalModifier: "none", ...extra });
// Match Sabres (visiteurs) au Centre Bell.
const landing = (away, home, periods, extra = {}) => ({
  gameState: "LIVE", periodDescriptor: periods.at(-1)?.periodDescriptor || REG(1),
  awayTeam: { abbrev: "BUF", commonName: { default: "Sabres" }, score: away },
  homeTeam: { abbrev: "MTL", commonName: { default: "Canadiens" }, score: home },
  summary: { scoring: periods }, ...extra });
const per = (pd, goals) => ({ periodDescriptor: pd, goals });

test("but du CH : nom, total de la saison, moment dans la période", () => {
  const L = landing(0, 1, [per(REG(1), []), per(REG(2), [goal("Caufield", 5, "MTL", "11:45")])]);
  assert.equal(lastGoal(L).text, "But de Caufield (5), à 11:45 de la 2e période");
});

test("but adverse : nom de l'équipe ajouté; zéro initial retiré; 1re période", () => {
  const L = landing(1, 0, [per(REG(1), [goal("Norris", 2, "BUF", "08:21")])]);
  assert.equal(lastGoal(L).text, "But de Norris (2), Sabres, à 8:21 de la 1re période");
});

test("avantage numérique, filet désert, tir de pénalité", () => {
  const pp = landing(0, 1, [per(REG(3), [goal("Suzuki", 4, "MTL", "15:02", { strength: "pp" })])]);
  assert.equal(lastGoal(pp).text, "But de Suzuki (4), en avantage numérique, à 15:02 de la 3e période");
  const en = landing(0, 1, [per(REG(3), [goal("Suzuki", 4, "MTL", "19:10", { goalModifier: "empty-net" })])]);
  assert.match(lastGoal(en).text, /, dans un filet désert, /);
  const ps = landing(0, 1, [per(REG(2), [goal("Dach", 1, "MTL", "02:00", { goalModifier: "penalty-shot" })])]);
  assert.match(lastGoal(ps).text, /, sur un tir de pénalité, /);
});

test("prolongation, puis 2e prolongation en séries", () => {
  const ot = landing(3, 4, [per(REG(1), [goal("A", 1, "BUF", "01:00"), goal("B", 1, "MTL", "02:00")]), per(REG(2), [goal("C", 1, "BUF", "03:00"), goal("D", 1, "MTL", "04:00")]),
    per(REG(3), [goal("E", 1, "BUF", "05:00"), goal("F", 1, "MTL", "06:00")]), per(OT(4), [goal("Caufield", 5, "MTL", "00:54")])], { gameState: "OFF" });
  assert.equal(lastGoal(ot).text, "But de Caufield (5), à 0:54 de la prolongation");
  const ot2 = landing(0, 1, [per(OT(5), [goal("Slafkovský", 3, "MTL", "12:30")])]);
  assert.equal(lastGoal(ot2).text, "But de Slafkovský (3), à 12:30 de la 2e prolongation");
});

test("aucune donnée trompeuse : pointage en avance sur le sommaire = détails en attente", () => {
  const L = landing(1, 2, [per(REG(1), [goal("Norris", 2, "BUF", "08:21"), goal("Bolduc", 4, "MTL", "11:45")])]);
  assert.deepEqual({ ...lastGoal(L) }, { pending: true });
});

test("aucune donnée trompeuse : sommaire en avance sur le pointage = rien", () => {
  const L = landing(0, 1, [per(REG(1), [goal("A", 1, "MTL", "01:00"), goal("B", 1, "MTL", "02:00")])]);
  assert.equal(lastGoal(L), null);
});

test("tirs de barrage : le but de plus du gagnant n'est pas dans le sommaire", () => {
  const L = landing(1, 2, [per(REG(1), [goal("Norris", 2, "BUF", "08:21")]), per(REG(3), [goal("Hutson", 3, "MTL", "10:00")])],
    { gameState: "OFF", periodDescriptor: { number: 5, periodType: "SO" }, gameOutcome: { lastPeriodType: "SO" } });
  assert.equal(lastGoal(L).text, "But de Hutson (3), à 10:00 de la 3e période");
});

test("aucun but, sommaire absent ou pointage absent : rien", () => {
  assert.equal(lastGoal(landing(0, 0, [per(REG(1), [])])), null);
  assert.equal(lastGoal({ awayTeam: { score: 1 }, homeTeam: { score: 0 } }), null);
  assert.equal(lastGoal(landing(undefined, 0, [])), null);
  assert.equal(lastGoal(null), null);
});

test("la clé change à chaque nouveau but (pour l'annonce VoiceOver)", () => {
  const one = landing(0, 1, [per(REG(1), [goal("A", 1, "MTL", "01:00")])]);
  const two = landing(0, 2, [per(REG(1), [goal("A", 1, "MTL", "01:00"), goal("B", 1, "MTL", "05:00")])]);
  assert.notEqual(lastGoal(one).key, lastGoal(two).key);
  assert.equal(lastGoal(one).key, lastGoal(structuredClone(one)).key);
});
