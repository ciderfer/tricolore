// Tests de la section « Blessés » (blesses.js) et de l'extraction ESPN (scripts/fetch-injuries.mjs).
// Lancer : node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import TB from "../blesses.js";
import { extract, nextFile, TEAM_ID, HEARTBEAT_MS } from "../scripts/fetch-injuries.mjs";

const NOW = Date.parse("2026-10-23T23:05:00Z"); // 19 h 05 à Montréal
const ago = (h) => new Date(NOW - h * 3600e3).toISOString();
const n = (fr) => ({ default: fr });
const roster = {
  forwards: [
    { id: 8481540, firstName: n("Nick"), lastName: n("Suzuki"), sweaterNumber: 14 },
    { id: 8484986, firstName: n("Florian"), lastName: n("Xhekaj"), sweaterNumber: 63 },
    { id: 8483681, firstName: n("Juraj"), lastName: n("Slafkovský"), sweaterNumber: 20 },
  ],
  defensemen: [{ id: 8482964, firstName: n("Arber"), lastName: n("Xhekaj"), sweaterNumber: 72 }],
  goalies: [{ id: 8477312, firstName: n("Samuel"), lastName: n("Montembeault"), sweaterNumber: 35 }],
};
const P = (o) => ({ name: `${o.firstName} ${o.lastName}`, pos: "C", status: "Injured Reserve", type: "Lower Body", returnDate: "2026-10-31", updated: "2026-10-17T17:08Z", ...o });
const file = (players, fetchedAt = ago(1)) => ({ source: "ESPN", fetchedAt, updatedAt: fetchedAt, players });

test("traductions des statuts (RDS/TVA), statut inconnu laissé brut", () => {
  assert.equal(TB.statusText("Injured Reserve"), "Liste des blessés");
  assert.equal(TB.statusText("Day-To-Day"), "Au jour le jour");
  assert.equal(TB.statusText("Out"), "Absent");
  assert.equal(TB.statusText("Suspension"), "Suspension");
  assert.equal(TB.statusText(null), "Statut inconnu");
});

test("traductions des blessures, type inconnu laissé brut", () => {
  assert.equal(TB.typeText("Upper Body"), "Haut du corps");
  assert.equal(TB.typeText("Lower Body"), "Bas du corps");
  assert.equal(TB.typeText("Undisclosed"), "Non divulguée");
  assert.equal(TB.typeText("Knee"), "Knee");
  assert.equal(TB.typeText(undefined), "");
});

test("dates : retour estimé sans décalage de fuseau, horodatage à l'heure de l'Est", () => {
  assert.equal(TB.returnText("2026-10-31"), "31 oct.");
  assert.equal(TB.returnText("2026-11-01"), "1 nov.");
  assert.equal(TB.returnText("31/10"), "");
  assert.equal(TB.stamp("2026-10-23T23:05:00Z"), "23 oct., 19 h 05");
});

test("jumelage ESPN → LNH : Sam = Samuel, Florian ≠ Arber, accents ignorés", () => {
  assert.equal(TB.match(roster, { firstName: "Sam", lastName: "Montembeault" })?.id, 8477312);
  assert.equal(TB.match(roster, { firstName: "Florian", lastName: "Xhekaj" })?.id, 8484986);
  assert.equal(TB.match(roster, { firstName: "Arber", lastName: "Xhekaj" })?.id, 8482964);
  assert.equal(TB.match(roster, { firstName: "Juraj", lastName: "Slafkovsky" })?.id, 8483681);
  assert.equal(TB.match(roster, { firstName: "Bryce", lastName: "Pickford" }), null); // pas dans l'alignement
  assert.equal(TB.match(roster, { firstName: "", lastName: "Xhekaj" }), null);
  assert.equal(TB.match(null, { firstName: "Nick", lastName: "Suzuki" }), null);
});

test("coupure à 3 jours : ok jusqu'à 72 h, puis message", () => {
  assert.equal(TB.state(file([], ago(72)), NOW), "ok");
  assert.equal(TB.state(file([], ago(72.01)), NOW), "stale");
  assert.equal(TB.state(null, NOW), "error");
  assert.equal(TB.state({ players: [] }, NOW), "error"); // sans fetchedAt
  const html = TB.section(file([P({ firstName: "Nick", lastName: "Suzuki" })], ago(80)), roster, NOW);
  assert.match(html, /source ESPN indisponible \(aucune mise à jour depuis plus de 3 jours\)/);
  assert.doesNotMatch(html, /Suzuki/);
  assert.equal(TB.injuredIds(file([P({ firstName: "Nick", lastName: "Suzuki" })], ago(80)), roster, NOW).size, 0);
});

test("états vide et erreur", () => {
  const empty = TB.section(file([]), roster, NOW);
  assert.match(empty, /Aucun blessé signalé\./);
  assert.match(empty, /Source : ESPN · mis à jour le 23 oct\., 18 h 05\./);
  const err = TB.section(null, roster, NOW, "HTTP 404");
  assert.match(err, /class="err">Blessés : source ESPN indisponible \(HTTP 404\)\. Aucune donnée affichée/);
  assert.match(TB.section(undefined, roster, NOW), /\(données absentes\)/);
});

test("section : groupes par statut, tri par retour, numéro et lien seulement si jumelé, texte échappé", () => {
  const inj = file([
    P({ firstName: "Nick", lastName: "Suzuki", status: "Out", type: "Upper Body", returnDate: "2026-11-18" }),
    P({ firstName: "Bryce", lastName: "Pickford", pos: "D", type: "Undisclosed" }),
    P({ firstName: "Sam", lastName: "Montembeault", pos: "G", returnDate: "2026-10-25" }),
    P({ firstName: "Ti<b>", lastName: "Gars", status: "Day-To-Day" }),
  ]);
  const html = TB.section(inj, roster, NOW);
  const order = ["Au jour le jour", "Absent", "Liste des blessés"].map((t) => html.indexOf(`>${t} <span>`));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], "ordre des groupes");
  assert.ok(html.indexOf("Montembeault") < html.indexOf("Pickford"), "retour le plus proche d'abord");
  assert.match(html, /<span class="num">35<\/span>.*?href="joueur\.html\?id=8477312"/s);
  assert.match(html, /<span class="num">—<\/span><abbr class="lbl" title="Défenseur">D<\/abbr><\/span><span class="pl-id"><span class="pl-name cond">Bryce Pickford/);
  assert.match(html, /Haut du corps · Retour estimé : 18 nov\./);
  assert.match(html, /Les dates de retour sont des estimations/);
  assert.match(html, /Ti&lt;b&gt; Gars/);
  assert.deepEqual([...TB.injuredIds(inj, roster, NOW)].sort(), [8477312, 8481540]);
});

const espn = (teams) => ({ timestamp: "x", injuries: teams });
const raw = (over = {}) => ({ id: "1", status: "Out", date: "2026-10-22T15:30Z", longComment: "Texte rédigé à ne jamais copier.", shortComment: "Idem.",
  athlete: { displayName: "Nick Suzuki", firstName: "Nick", lastName: "Suzuki", position: { abbreviation: "C" } },
  details: { type: "Upper Body", returnDate: "2026-11-18", fantasyStatus: { abbreviation: "OUT" } }, ...over });

test("extract : champs structurés du CH seulement, jamais de commentaire rédigé", () => {
  const out = extract(espn([{ id: "25", injuries: [raw({ athlete: { displayName: "Autre", lastName: "Autre" } })] }, { id: TEAM_ID, injuries: [raw()] }]));
  assert.deepEqual(out, [{ name: "Nick Suzuki", firstName: "Nick", lastName: "Suzuki", pos: "C", status: "Out", type: "Upper Body", returnDate: "2026-11-18", updated: "2026-10-22T15:30Z" }]);
  assert.doesNotMatch(JSON.stringify(out), /rédigé|Idem|fantasy/);
});

test("extract : CH absent d'une réponse valide = aucun blessé; format inattendu = erreur", () => {
  assert.deepEqual(extract(espn([{ id: "25", injuries: [raw()] }])), []);
  assert.throws(() => extract({}), /format inattendu/);
  assert.throws(() => extract(espn([])), /format inattendu/);
  assert.throws(() => extract(espn([{ id: TEAM_ID }])), /format inattendu/);
  assert.deepEqual(extract(espn([{ id: TEAM_ID, injuries: [raw({ status: "" })] }])), []); // entrée incomplète écartée
  assert.equal(extract(espn([{ id: TEAM_ID, injuries: [raw({ details: { returnDate: "bientôt" } })] }]))[0].returnDate, null);
});

test("nextFile : réécrit si la liste change ou toutes les 45 min, sinon rien", () => {
  const now = new Date(NOW);
  const players = [{ name: "Nick Suzuki" }];
  const old = { fetchedAt: new Date(NOW - HEARTBEAT_MS + 60e3).toISOString(), updatedAt: "2026-10-20T00:00:00.000Z", players };
  assert.equal(nextFile(old, players, now), null);
  const beat = nextFile({ ...old, fetchedAt: new Date(NOW - HEARTBEAT_MS - 60e3).toISOString() }, players, now);
  assert.equal(beat.fetchedAt, now.toISOString());
  assert.equal(beat.updatedAt, "2026-10-20T00:00:00.000Z");
  const changed = nextFile(old, [], now);
  assert.equal(changed.updatedAt, now.toISOString());
  assert.equal(nextFile(null, [], now).source, "ESPN");
});
