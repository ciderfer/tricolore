// Génère une paire de clés VAPID (P-256) pour les alertes de match, sans dépendance (Node 22+).
//   node vapid-keys.mjs            → affiche les deux clés (base64url)
//   node vapid-keys.mjs --dev-vars → lignes prêtes pour worker/.dev.vars (tests locaux seulement)
// La clé privée ne doit jamais être commitée : en production, `npx wrangler secret put VAPID_PRIVATE_KEY`.
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64url");
const { d } = await crypto.subtle.exportKey("jwk", kp.privateKey);
if (process.argv.includes("--dev-vars")) {
  console.log(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${d}\nVAPID_SUBJECT=mailto:test@localhost`);
} else {
  console.log(`VAPID_PUBLIC_KEY  ${pub}\nVAPID_PRIVATE_KEY ${d}`);
}
