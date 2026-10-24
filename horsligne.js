// Tricolore — hors ligne. Enregistre sw.js (le même service worker que les alertes, portée /tricolore/) sur chaque
// page, et affiche un bandeau quand la page montre des données gardées en mémoire : le service worker le dit
// (message « tricolore-hors-ligne ») ou le téléphone se sait sans réseau. Jamais de copie présentée comme actuelle.
// L'heure affichée est celle des données en mémoire (data/meta.json : updatedAt), sinon celle de la copie.
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch((e) => console.warn("Service worker non enregistré :", e.message));

  const fmt = window.T?.fStamp || new Intl.DateTimeFormat("fr-CA", { timeZone: "America/Toronto", dateStyle: "long", timeStyle: "short" });
  let box = null, pending = null, text = "";

  async function when(date) {
    try {
      const r = await caches.match(new URL("data/meta.json", location.href).href, { ignoreSearch: true });
      const t = Date.parse((r && (await r.json()))?.updatedAt || "");
      if (t) return t;
    } catch { /* pas de copie lisible */ }
    return Date.parse(date || "") || null;
  }
  function show(date) {
    pending ??= when(date).then((t) => {
      const main = document.querySelector("main");
      if (!main) return;
      box = document.createElement("div");
      box.id = "hors-ligne";
      box.className = "stale";
      box.setAttribute("role", "status");
      box.style.maxWidth = "var(--maxw)"; // sur ordi, aligné sur la colonne du site (CSSOM, permis par la CSP)
      box.style.margin = "0 auto";
      box.textContent = text = t
        ? `Hors ligne : données en mémoire du ${fmt.format(new Date(t))} (heure de l’Est). Elles peuvent être périmées.`
        : "Hors ligne : données en mémoire, possiblement périmées.";
      main.before(box);
    });
  }

  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "tricolore-hors-ligne") show(e.data.date); });
  navigator.serviceWorker.startMessages(); // messages reçus pendant le chargement de la page
  if (navigator.onLine === false) show();
  addEventListener("offline", () => { if (box) box.textContent = text; else show(); });
  addEventListener("online", () => { if (box) box.textContent = "Connexion rétablie. Rechargez la page pour avoir les données à jour."; });
})();
