// Tricolore — page Alertes de match (alertes.html) : abonnement Web Push aux alertes du Canadien.
// Le Worker (worker/alertes.js) suit le match chaque minute et envoie « Le match commence », les buts et le final,
// seulement à partir de ce que rend l'API LNH. Le service worker sw.js affiche l'alerte et ouvre la feuille de match.
// iPhone (iOS 16.4+) : les alertes ne marchent que depuis l'icône de l'écran d'accueil (mode « standalone »).
(function () {
  "use strict";
  const { esc, WORKER, WORDMARK, UNOFFICIAL, errBox } = T;
  const app = document.getElementById("app");
  const KINDS = [
    ["debut", "Début du match", "« Le match commence »"],
    ["buts", "Buts", "Les deux équipes : qui a marqué, le pointage, la période"],
    ["final", "Final", "Le pointage final"],
  ];
  const STORE = "tricolore.alertes"; // choix enregistrés sur cet appareil (le Worker garde les mêmes)

  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  let reg = null, key = null, busy = false, msg = "";

  const head = `<section class="hero page-hero"><div class="top"><div class="wordmark">${WORDMARK}</div><div class="lbl"><a class="back" href="./">‹ Match</a></div></div>
    <h1 class="page-title cond">Alertes<br><span>de match</span></h1></section>`;

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE) || "null");
      if (p && typeof p === "object") return { debut: p.debut !== false, buts: p.buts !== false, final: p.final !== false };
    } catch { /* stockage indisponible : choix par défaut */ }
    return { debut: true, buts: true, final: true };
  }
  function savePrefs(p) { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* rien */ } }
  const readPrefs = () => Object.fromEntries(KINDS.map(([k]) => [k, !!document.getElementById(`al-${k}`)?.checked]));

  function b64uToBytes(s) {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  async function post(path, body) {
    const r = await fetch(WORKER + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    let j = null;
    try { j = await r.json(); } catch { /* corps illisible */ }
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
  }

  const show = (html) => { app.innerHTML = head + html; };
  const note = () => `<p class="ics-note al-msg" role="status" aria-live="polite">${esc(msg)}</p>`;

  // iPhone dans Safari : il faut d'abord ajouter le site à l'écran d'accueil.
  function homeScreenSteps() {
    show(`<section class="blk"><h2 class="h cond">Sur l’écran<br>d’accueil d’abord</h2>
      <p class="none">Sur iPhone, les alertes fonctionnent seulement depuis l’icône Tricolore de l’écran d’accueil (iOS 16.4 ou plus récent).</p>
      <ol class="al-steps">
        <li>Dans Safari, touchez <b>Share</b> (le carré avec une flèche vers le haut).</li>
        <li>Touchez <b>Add to Home Screen</b>, puis <b>Add</b>.</li>
        <li>Ouvrez Tricolore depuis l’écran d’accueil, puis touchez « Alertes de match » au bas de la page.</li>
      </ol></section>`);
  }

  function render(sub) {
    const on = !!sub;
    const prefs = loadPrefs();
    const denied = Notification.permission === "denied";
    const opts = KINDS.map(([k, label, hint]) => `<label class="al-opt"><input type="checkbox" id="al-${k}"${prefs[k] ? " checked" : ""}${busy ? " disabled" : ""}><span>${esc(label)}<small>${esc(hint)}</small></span></label>`).join("");
    show(`<section class="blk"><h2 class="h cond">${on ? "Alertes<br>activées" : "Suivez<br>le CH"}</h2>
      <p class="none">${on ? "Cet appareil reçoit les alertes cochées. Vos choix s’enregistrent dès que vous les changez." : "Recevez une alerte sur cet appareil pendant les matchs du Canadien."}</p>
      <fieldset class="al-opts"${busy ? " disabled" : ""}><legend class="lbl">Quand m’avertir</legend>${opts}</fieldset>
      ${denied && !on ? `<p class="warn-note">Notifications refusées pour Tricolore. Pour les permettre : ${iOS ? "Settings › Notifications › Tricolore" : "réglages du site dans le navigateur"}.</p>`
        : `<button type="button" class="ics-btn al-btn${on ? " al-off" : ""}" id="al-btn"${busy ? " disabled" : ""}>${on ? "Désactiver" : "Activer les alertes"}</button>`}
      ${note()}</section>`);
    const btn = document.getElementById("al-btn");
    if (btn) btn.addEventListener("click", on ? () => disable(sub) : enable);
    for (const [k] of KINDS) document.getElementById(`al-${k}`).addEventListener("change", () => changed(sub));
  }

  function enable() {
    const prefs = readPrefs();
    if (!Object.values(prefs).some(Boolean)) { msg = "Cochez au moins une alerte."; render(null); return; }
    // subscribe() tout de suite, dans le geste de l'utilisateur (exigé par Safari) : il demande aussi la permission.
    const pending = reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
    busy = true; msg = "Activation…"; render(null);
    pending.then(async (sub) => {
      try {
        await post("/push/subscribe", { subscription: sub.toJSON(), prefs });
      } catch (e) {
        await sub.unsubscribe().catch(() => {});
        throw e;
      }
      savePrefs(prefs);
      busy = false; msg = "C’est parti : vous serez averti pendant les matchs du CH."; render(sub);
    }).catch((e) => {
      busy = false;
      msg = Notification.permission === "denied" ? "" : `Activation impossible (${e.message || "erreur"}).`;
      render(null);
    });
  }

  async function disable(sub) {
    busy = true; msg = "Désactivation…"; render(sub);
    let warn = "";
    try { await post("/push/unsubscribe", { endpoint: sub.endpoint }); } catch (e) { warn = ` (relais : ${e.message})`; }
    try { await sub.unsubscribe(); } catch { /* déjà retiré */ }
    busy = false; msg = `Alertes désactivées sur cet appareil${warn}.`; render(null);
  }

  async function changed(sub) {
    const prefs = readPrefs();
    if (!sub) { savePrefs(prefs); return; }
    if (!Object.values(prefs).some(Boolean)) { msg = "Gardez au moins une alerte, ou touchez « Désactiver »."; render(sub); return; }
    busy = true; msg = "Enregistrement…"; render(sub);
    try { await post("/push/subscribe", { subscription: sub.toJSON(), prefs }); savePrefs(prefs); msg = "Choix enregistrés."; }
    catch (e) { msg = `Choix non enregistrés (${e.message}).`; }
    busy = false; render(sub);
  }

  async function start() {
    document.getElementById("foot").innerHTML = `<p>Alertes : API publique de la LNH, par le relais Tricolore (Cloudflare). Aucune donnée inventée : une alerte reprend seulement ce que la LNH publie.</p>${UNOFFICIAL}`;
    if (iOS && !standalone) return homeScreenSteps();
    if (!supported) return show(`<section class="blk"><p class="none">Ce navigateur ne reçoit pas les alertes Web Push.${iOS ? " Il faut iOS 16.4 ou plus récent." : ""}</p></section>`);
    try {
      await navigator.serviceWorker.register("sw.js", { scope: "./" });
      reg = await navigator.serviceWorker.ready;
    } catch (e) { return show(`<section class="blk">${errBox("Alertes", `service worker : ${e.message}`, false)}</section>`); }
    try { key = (await T.getJson(`${WORKER}/push/vapid-public-key`)).key; } catch (e) {
      return show(`<section class="blk">${errBox("Alertes", `relais Tricolore : ${e.message}`, false)}</section>`);
    }
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(key)) return show(`<section class="blk">${errBox("Alertes", "clé du relais invalide", false)}</section>`);
    const sub = await reg.pushManager.getSubscription();
    render(sub);
    // Abonnement déjà présent : on le redonne au Worker (aucune écriture s'il le connaît déjà; utile si l'adresse a changé).
    if (sub) post("/push/subscribe", { subscription: sub.toJSON(), prefs: loadPrefs() }).catch((e) => { msg = `Relais injoignable (${e.message}).`; render(sub); });
  }

  start().catch((e) => { console.error(e); show(`<section class="blk">${errBox("Alertes", "erreur d’affichage", false)}</section>`); });
})();
