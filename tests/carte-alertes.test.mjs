// Tests de la carte « Alertes de match » de l'accueil (T.pushDevice et T.alertCard dans commun.js, chargé tel quel
// dans un bac à sable). Lancer : node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { window: {}, location: { search: "" }, URLSearchParams, console };
vm.runInNewContext(readFileSync(new URL("../commun.js", import.meta.url), "utf8"), ctx);
const { pushDevice, alertCard } = ctx.window.T;

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 354.0.0",
  ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  chromeDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  firefoxDesktop: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
};

// Navigateur simulé : ua, iPad (MacIntel + écran tactile), écran d'accueil, Web Push présent, permission.
function card(ua, { ipad = false, home = false, push = true, permission = "default", subscribed = false } = {}) {
  const nav = { userAgent: ua, platform: ipad ? "MacIntel" : "x", maxTouchPoints: ipad ? 5 : 0, ...(push ? { serviceWorker: {} } : {}) };
  const win = { matchMedia: (q) => ({ matches: home && q === "(display-mode: standalone)" }), ...(push ? { PushManager() {}, Notification: { permission } } : {}) };
  return alertCard(pushDevice(nav, win), subscribed);
}

test("iPhone ou iPad dans Safari, hors de l'écran d'accueil : les 3 étapes pour l'ajouter", () => {
  assert.equal(card(UA.iphoneSafari, { push: false }), "installer");
  assert.equal(card(UA.iphoneSafari), "installer"); // même si Safari expose Web Push
  assert.equal(card(UA.ipadDesktop, { ipad: true, push: false }), "installer"); // iPad en mode « site pour ordinateur »
});

test("iPhone hors Safari (Chrome, Instagram) : pas de carte (les étapes parlent de Safari)", () => {
  assert.equal(card(UA.iphoneChrome, { push: false }), "");
  assert.equal(card(UA.iphoneInstagram, { push: false }), "");
});

test("app installée sur iPhone, ou navigateur compatible : bouton tant que l'appareil n'est pas abonné", () => {
  assert.equal(card(UA.iphoneSafari, { home: true }), "activer");
  assert.equal(card(UA.ipadDesktop, { ipad: true, home: true }), "activer");
  assert.equal(card(UA.chromeDesktop), "activer");
  assert.equal(card(UA.firefoxDesktop), "activer");
  assert.equal(card(UA.ipadDesktop), "activer"); // Safari sur Mac (pas tactile) : Web Push direct
});

test("déjà abonné, notifications refusées, ou Web Push absent : carte cachée", () => {
  assert.equal(card(UA.iphoneSafari, { home: true, subscribed: true }), "");
  assert.equal(card(UA.chromeDesktop, { subscribed: true }), "");
  assert.equal(card(UA.chromeDesktop, { permission: "denied" }), "");
  assert.equal(card(UA.iphoneSafari, { home: true, push: false }), ""); // iOS avant 16.4
  assert.equal(card(UA.firefoxDesktop, { push: false }), "");
});
