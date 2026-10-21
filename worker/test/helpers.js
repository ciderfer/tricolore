// Outils des tests : KV en mémoire (avec compteurs), états d'un vrai match (2026020141, MTL-SJS du 20 octobre 2026)
// rejoués étape par étape, abonné de test (clés générées) et déchiffrement RFC 8291.
import { readFileSync } from "node:fs";
import { b64u, unb64u } from "../push.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
export const LANDING = fx("2026020141-landing.json");
export const SCOREBOARD = fx("scoreboard-2026020141.json");
export const GAME_ID = 2026020141;
export const START = Date.parse("2026-10-20T23:00:00Z");

export function memKV() {
  const m = new Map();
  const kv = {
    m, writes: 0, deletes: 0, lists: 0, reads: 0,
    async get(k, type) { kv.reads++; const e = m.get(k); if (!e) return null; return type === "json" ? JSON.parse(e.value) : e.value; },
    async getWithMetadata(k) { kv.reads++; const e = m.get(k); return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null }; },
    async put(k, value, opts = {}) { kv.writes++; m.set(k, { value: String(value), metadata: opts.metadata }); },
    async delete(k) { kv.deletes++; m.delete(k); },
    async list({ prefix = "", limit = 1000 } = {}) {
      kv.lists++;
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name, metadata: m.get(name).metadata }));
      return { keys, list_complete: true };
    },
  };
  return kv;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
// État du match après les n premiers buts réels. state : PRE, LIVE, FINAL. Les pointages viennent des buts eux-mêmes.
export function stage(n, state = "LIVE") {
  const land = clone(LANDING);
  let left = n, last = null;
  for (const p of land.summary.scoring) { p.goals = p.goals.slice(0, Math.max(0, left)); left -= p.goals.length; if (p.goals.length) last = p; }
  land.summary.scoring = land.summary.scoring.filter((p) => p.goals.length || p === land.summary.scoring[0]);
  const goals = land.summary.scoring.flatMap((p) => p.goals);
  const g = goals.at(-1);
  const sb = clone(SCOREBOARD);
  const game = sb.gamesByDate[0].games[0];
  game.gameState = state; land.gameState = state;
  if (state === "PRE" || state === "FUT") { delete game.awayTeam.score; delete game.homeTeam.score; land.summary.scoring = []; }
  else {
    game.awayTeam.score = g ? g.awayScore : 0; game.homeTeam.score = g ? g.homeScore : 0;
    const pd = state === "FINAL" ? LANDING.periodDescriptor : (last?.periodDescriptor || { number: 1, periodType: "REG", maxRegulationPeriods: 3 });
    game.periodDescriptor = pd; game.period = pd.number; land.periodDescriptor = pd;
  }
  return { scoreboard: sb, landing: land };
}

// Remplace fetch : API LNH (étape courante) et faux services de push (déchiffrent et notent les messages reçus).
export function mockNet() {
  const net = { stage: stage(0, "PRE"), pushes: [], push: new Map(), github: [], githubStatus: 204, nhl: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://api-web.nhle.com/v1/scoreboard/MTL/now")) { net.nhl++; return Response.json(net.stage.scoreboard); }
    if (u.startsWith(`https://api-web.nhle.com/v1/gamecenter/${GAME_ID}/landing`)) { net.nhl++; return Response.json(net.stage.landing); }
    if (u.startsWith("https://api.github.com/")) { net.github.push({ url: u, init }); return new Response(null, { status: net.githubStatus }); }
    const sub = net.push.get(u);
    if (sub) {
      if (sub.status !== 201) return new Response("", { status: sub.status });
      const payload = JSON.parse(await decrypt(new Uint8Array(init.body), sub));
      net.pushes.push({ to: sub.name, headers: init.headers, payload });
      return new Response("", { status: 201 });
    }
    throw new Error(`fetch inattendu : ${u}`);
  };
  return net;
}

// Abonné de test : paire ECDH P-256 et secret auth générés ici (comme le ferait le navigateur).
export async function makeSubscriber(name, endpoint = `https://fcm.googleapis.com/fcm/send/${name}`) {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { name, endpoint, privateKey: kp.privateKey, p256dh: b64u(pub), auth: b64u(auth), status: 201,
    json: { endpoint, keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
}

async function hkdf(salt, ikm, info, n) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, n * 8));
}
const te = new TextEncoder();
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

// Déchiffrement côté abonné (RFC 8291 / RFC 8188), écrit indépendamment de push.js.
export async function decrypt(body, { privateKey, p256dh, auth }) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  if (rs < 18 || idlen !== 65 || ct.length > rs) throw new Error("en-tête aes128gcm invalide");
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, privateKey, 256));
  const ikm = await hkdf(unb64u(auth), ecdh, cat(te.encode("WebPush: info\0"), unb64u(p256dh), asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, k, ct));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--; // bourrage
  if (plain[end] !== 2) throw new Error("délimiteur de dernier enregistrement absent");
  return new TextDecoder().decode(plain.slice(0, end));
}

// Clés VAPID de test (générées à chaque exécution, jamais réutilisées ailleurs).
export async function testVapid() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { VAPID_PUBLIC_KEY: b64u(pub), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: "mailto:test@example.com", verifyKey: kp.publicKey };
}
