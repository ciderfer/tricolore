import { test } from "node:test";
import assert from "node:assert/strict";
import { b64u, unb64u, encrypt, vapidAuth } from "../push.js";
import { decrypt, makeSubscriber, testVapid } from "./helpers.js";

const dec = (s) => JSON.parse(new TextDecoder().decode(unb64u(s)));

test("VAPID : JWT ES256 valide (en-tête, aud, exp, sub, signature, k=)", async () => {
  const v = await testVapid();
  const now = 1_800_000_000;
  const h = await vapidAuth("https://web.push.apple.com/QGuQyavXutnMH/abc?x=1", { publicKey: v.VAPID_PUBLIC_KEY, privateKey: v.VAPID_PRIVATE_KEY, subject: v.VAPID_SUBJECT }, now);
  const m = h.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, h);
  assert.deepEqual(dec(m[1]), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(dec(m[2]), { aud: "https://web.push.apple.com", exp: now + 12 * 3600, sub: "mailto:test@example.com" });
  assert.equal(m[4], v.VAPID_PUBLIC_KEY);
  const sig = unb64u(m[3]);
  assert.equal(sig.length, 64); // r || s, format JWS
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, v.verifyKey, sig, new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.ok(ok, "signature vérifiée avec la clé publique");
  assert.ok(dec(m[2]).exp - now <= 24 * 3600, "exp ≤ 24 h (RFC 8292)");
});

test("VAPID : refuse une clé privée invalide", async () => {
  const v = await testVapid();
  await assert.rejects(vapidAuth("https://fcm.googleapis.com/x", { publicKey: v.VAPID_PUBLIC_KEY, privateKey: b64u(new Uint8Array(31)), subject: "mailto:a@b.c" }));
});

test("aes128gcm : vecteur de test de la RFC 8291 (annexe A), octet pour octet", async () => {
  const asPub = unb64u("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const jwk = { kty: "EC", crv: "P-256", x: b64u(asPub.slice(1, 33)), y: b64u(asPub.slice(33)), d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw" };
  const keyPair = {
    privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, true, []),
  };
  const body = await encrypt("When I grow up, I want to be a watermelon", {
    p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg",
  }, { keyPair, salt: unb64u("DGv6ra1nlYgDCS1FRnbzlw") });
  assert.equal(b64u(body), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("aes128gcm : aller-retour avec une clé d'abonné générée par le test", async () => {
  const sub = await makeSubscriber("rt");
  const msg = JSON.stringify({ title: "But du CH !", body: "C. Caufield (6) · CH 3, Sharks 1 · 2e période, 14:03" });
  const body = await encrypt(msg, { p256dh: sub.p256dh, auth: sub.auth });
  assert.equal(body[20], 65);
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(await decrypt(body, sub), msg);
  const other = await makeSubscriber("autre");
  await assert.rejects(decrypt(body, { ...other, p256dh: sub.p256dh }), "une autre clé ne déchiffre pas");
  assert.notEqual(b64u(await encrypt(msg, sub)), b64u(body), "sel et clé éphémère neufs à chaque envoi");
});
