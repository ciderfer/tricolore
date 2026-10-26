// Tricolore — pointage en direct poussé par WebSocket : un Durable Object « Direct » par match (liaison DIRECT).
//
// Pourquoi : chaque requête au Worker compte dans le quota gratuit (100 000 par jour), même servie de son cache.
// À une lecture aux 15 s par partisan, environ 130 partisans en même temps l'épuisaient. Ici, un partisan ouvre
// une seule connexion (1 requête au Worker + 1 au Durable Object), puis l'objet lit la LNH pour tout le monde
// et pousse chaque changement à toutes les connexions. Les messages sortants ne comptent pas (tarifs Cloudflare).
// Les connexions sont « hibernables » (ctx.acceptWebSocket) : pas de durée facturée entre deux lectures.
//
// Lectures : « landing » aux 5 s en direct (15 s avant le match, 60 s s'il est loin); « boxscore » et « right-rail »
// chaque minute, seulement si une feuille de match est ouverte (étiquette « all »). En direct, chaque lecture passe
// outre la copie Cloudflare de la LNH (voir url()) : au plus 5 s de délai, au lieu d'environ 20 s.
// Messages : {"part","at","body"} (body : JSON de la LNH tel quel; at : heure de la lecture) ou {"part","error"}.
// Envoyés seulement quand ils changent, plus {"part":"ping"} après 25 s sans rien.
// À la connexion : ce qu'on a, seulement si c'est encore frais (lu il y a au plus un intervalle de lecture). Sinon
// (alarme arrêtée faute de partisans, objet resté en mémoire), on lit la LNH d'abord : sans ça, le premier pointage
// affiché pouvait dater de la dernière lecture (30 s, voire des minutes) jusqu'à l'alarme suivante. Match fini : dernier envoi complet, puis fermeture (code 1000). Pas un match du Canadien : 4404.
const UPSTREAM = "https://api-web.nhle.com";
const LIVE = new Set(["LIVE", "CRIT"]);
const DONE = new Set(["OFF", "FINAL"]);
const EVERY = { LIVE: 5_000, CRIT: 5_000, PRE: 15_000 }; // autre état (FUT) : 60 s
const SLOW_MS = 60_000;
const SLOW = ["boxscore", "right-rail"];
const MARGIN_MS = 1_000; // retard toléré d'une alarme avant de juger une lecture périmée

export class Direct {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.keys = {};   // dernier contenu envoyé, par partie (corps LNH ou « !erreur ») : on n'envoie que ce qui change
    this.readAt = {}; // heure de la dernière lecture, par partie (même sans changement)
    this.state = null; // dernier gameState lu
    this.waiting = new Map(); // nouvelles connexions qui attendent une lecture fraîche → parties encore dues
    this.slowAt = 0;
    this.lastSend = Date.now();
    this.polling = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const id = url.pathname.split("/")[2];
    this.gameId ??= await this.ctx.storage.get("id");
    if (!this.gameId) { this.gameId = id; await this.ctx.storage.put("id", id); }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const all = url.searchParams.get("parts") === "all";
    this.ctx.acceptWebSocket(server, [all ? "all" : "landing"]);
    this.ctx.waitUntil(this.welcome(server, all));
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + EVERY.LIVE);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Premier envoi à une nouvelle connexion. Frais : ce qu'on a, tout de suite. Périmé ou absent : une lecture
  // d'abord (partagée avec l'alarme si elle tombe en même temps); send() donne alors à ce partisan chaque partie
  // lue, même inchangée, avant une éventuelle fermeture (match fini). Le reste (non relu) suit, s'il existe.
  async welcome(ws, all) {
    const parts = new Set(all ? ["landing", ...SLOW] : ["landing"]);
    if (!this.isFresh(Date.now(), all)) {
      if (all && this.keys.boxscore === undefined) this.slowAt = 0;
      this.waiting.set(ws, parts);
      try { await this.poll(); } finally { this.waiting.delete(ws); }
    }
    for (const p of parts) if (this.keys[p] !== undefined) this.sendTo(ws, p);
  }

  isFresh(now, all) {
    const every = EVERY[this.state] ?? SLOW_MS;
    if (!(now - (this.readAt.landing ?? -Infinity) <= every + MARGIN_MS)) return false;
    return !all || now - (this.readAt.boxscore ?? -Infinity) <= SLOW_MS + MARGIN_MS;
  }

  sendTo(ws, part) {
    const msg = this.msg(part, this.keys[part], this.readAt[part]);
    try { ws.send(msg); } catch { /* fermée */ }
  }

  msg(part, key, at) {
    return key.startsWith("!") ? JSON.stringify({ part, error: key.slice(1) })
      : `{"part":"${part}","at":"${new Date(at).toISOString()}","body":${key}}`;
  }

  async alarm() {
    const next = await this.poll();
    if (next) await this.ctx.storage.setAlarm(Date.now() + next);
  }

  // Une lecture. Rend le délai avant la prochaine (ms), ou 0 : plus personne, match fini ou pas du Canadien.
  poll() {
    this.polling ??= this.read().finally(() => { this.polling = null; });
    return this.polling;
  }

  async read() {
    if (!this.ctx.getWebSockets().length) return 0;
    this.gameId ??= await this.ctx.storage.get("id");
    const now = Date.now();
    const land = await this.get("landing");
    let state = null;
    if (land.text) {
      let j = null;
      try { j = JSON.parse(land.text); } catch { land.error = "réponse LNH illisible"; land.text = null; }
      if (j) {
        if (j.awayTeam?.abbrev !== "MTL" && j.homeTeam?.abbrev !== "MTL") {
          for (const ws of this.ctx.getWebSockets()) ws.close(4404, "match du Canadien seulement");
          return 0;
        }
        state = j.gameState;
        this.state = state;
      }
    }
    this.send("landing", land, now);
    const done = DONE.has(state);
    if (this.ctx.getWebSockets("all").length && (done || now - this.slowAt >= SLOW_MS)) {
      this.slowAt = now;
      const res = await Promise.all(SLOW.map((p) => this.get(p)));
      SLOW.forEach((p, i) => this.send(p, res[i], now, "all"));
    }
    // Rien de neuf depuis 25 s : un signe de vie, pour que le navigateur sache que la connexion tient.
    if (now - this.lastSend >= 25_000) { this.lastSend = now; for (const ws of this.ctx.getWebSockets()) { try { ws.send('{"part":"ping"}'); } catch { /* fermée */ } } }
    if (done) { for (const ws of this.ctx.getWebSockets()) ws.close(1000, "match terminé"); return 0; }
    return EVERY[state] ?? 60_000;
  }

  // En direct (ou état encore inconnu), la LNH sert sa copie Cloudflare jusqu'à 19 s (max-age=19, cf-cache-status HIT) :
  // lire aux 5 s ne servait à rien. Un paramètre ?t= unique contourne cette copie (cf-cache-status MISS);
  // vérifié depuis un Worker : cache: "no-store" et cf.cacheTtl = 0 n'y changent rien (toujours HIT). Une seule
  // lecture aux 5 s par match pour tous les partisans (et boxscore/right-rail chaque minute) : la charge reste minime.
  // Avant le match (PRE, FUT) et après : copie de la LNH, comme avant.
  url(part, now = Date.now()) {
    const u = `${this.env.NHL_API || UPSTREAM}/v1/gamecenter/${this.gameId}/${part}`;
    return this.state == null || LIVE.has(this.state) ? `${u}?t=${now}` : u;
  }

  async get(part) {
    try {
      const r = await fetch(this.url(part), {
        headers: { "user-agent": "tricolore (site de partisan; github.com/ciderfer/tricolore)" } });
      if (!r.ok) return { error: `LNH : HTTP ${r.status}` };
      return { text: await r.text() };
    } catch { return { error: "LNH injoignable" }; }
  }

  // Envoie une partie à ceux qui la suivent, seulement si elle a changé (l'heure de lecture n'en fait pas partie).
  send(part, { text, error }, now, tag) {
    const key = text ?? `!${error}`;
    this.readAt[part] = now;
    const changed = this.keys[part] !== key;
    this.keys[part] = key;
    for (const [ws, due] of this.waiting) if (due.delete(part) && !changed) this.sendTo(ws, part);
    if (!changed) return;
    const msg = this.msg(part, key, now);
    this.lastSend = now;
    for (const ws of this.ctx.getWebSockets(tag)) { try { ws.send(msg); } catch { /* connexion fermée entre-temps */ } }
  }

  webSocketMessage() { /* le navigateur n'envoie rien */ }
  webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code); } catch { /* déjà fermée */ } }
  webSocketError() {}
}
