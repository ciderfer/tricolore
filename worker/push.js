// Tricolore — Web Push sans dépendance (WebCrypto seulement, dans le Worker comme dans Node 22).
// - VAPID (RFC 8292) : jeton JWT ES256 signé avec la clé privée du serveur, en-tête « Authorization: vapid t=…, k=… ».
// - Chiffrement du message (RFC 8291, codage « aes128gcm » de la RFC 8188) : ECDH P-256 avec la clé de l'abonné,
//   HKDF-SHA-256 (avec le secret « auth » de l'abonné), AES-128-GCM, un seul enregistrement.

const enc = new TextEncoder();

export function b64u(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(str) {
  if (typeof str !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(str)) throw new Error("base64url invalide");
  const s = atob(str.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

// Clé publique P-256 brute (65 octets, 0x04 || X || Y) en JWK, avec d (32 octets) pour une clé privée.
function jwk(pub, d) {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("clé publique P-256 invalide");
  const k = { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
  if (d) k.d = b64u(d);
  return k;
}

// Jeton VAPID pour l'origine du service de push (aud). Valide 12 h (maximum permis : 24 h).
export async function vapidAuth(endpoint, { publicKey, privateKey, subject }, nowSec = Math.floor(Date.now() / 1000)) {
  const pub = unb64u(publicKey), d = unb64u(privateKey);
  if (d.length !== 32) throw new Error("clé privée VAPID invalide");
  const key = await crypto.subtle.importKey("jwk", jwk(pub, d), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject })));
  // WebCrypto donne la signature brute r || s (64 octets), exactement le format JWS ES256.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey.replace(/=+$/, "")}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// Chiffre le message pour un abonné (keys.p256dh, keys.auth en base64url). Rend le corps complet de la requête :
// sel (16) || taille d'enregistrement (4) || longueur de la clé (1) || clé publique éphémère (65) || texte chiffré.
// Le paramètre « fixed » (sel et paire de clés imposés) ne sert qu'aux tests.
export async function encrypt(payload, { p256dh, auth }, fixed = {}) {
  const uaPub = unb64u(p256dh), secret = unb64u(auth);
  if (uaPub.length !== 65 || uaPub[0] !== 4) throw new Error("clé p256dh invalide");
  if (secret.length !== 16) throw new Error("secret auth invalide");
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const as = fixed.keyPair || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));

  const ikm = await hkdf(secret, ecdh, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const plain = concat(typeof payload === "string" ? enc.encode(payload) : payload, new Uint8Array([2])); // 2 : dernier enregistrement
  const rs = 4096;
  if (plain.length + 16 > rs) throw new Error("message trop long");
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = 65;
  return concat(header, asPub, ct);
}

// Envoie un message chiffré. Rend le statut HTTP du service de push (201 = accepté; 404 et 410 = abonnement mort).
// topic : remplace un message pas encore livré qui a le même sujet (au plus 32 caractères base64url).
// auth : en-tête VAPID déjà calculé pour l'origine de cet endpoint (un seul jeton par service et par exécution).
export async function sendPush(sub, payload, vapid, { ttl = 3600, urgency = "high", topic, auth } = {}) {
  const body = await encrypt(JSON.stringify(payload), sub.keys);
  const headers = {
    authorization: auth || await vapidAuth(sub.endpoint, vapid),
    "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
    ttl: String(ttl), urgency,
  };
  if (topic && /^[A-Za-z0-9_-]{1,32}$/.test(topic)) headers.topic = topic;
  const r = await fetch(sub.endpoint, { method: "POST", headers, body });
  return r.status;
}
