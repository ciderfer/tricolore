// Tricolore — pointage en direct poussé par WebSocket : un Durable Object « Direct » par match (liaison DIRECT).
//
// Pourquoi : chaque requête au Worker compte dans le quota gratuit (100 000 par jour), même servie de son cache.
// À une lecture aux 15 s par partisan, environ 130 partisans en même temps l'épuisaient. Ici, un partisan ouvre
// une seule connexion (1 requête au Worker + 1 au Durable Object), puis l'objet lit la LNH pour tout le monde
// et pousse chaque changement à toutes les connexions. Les messages sortants ne comptent pas (tarifs Cloudflare).
// Les connexions sont « hibernables » (ctx.acceptWebSocket) : pas de durée facturée entre deux lectures.
//
// Lectures : « landing » aux 5 s en direct (15 s avant le match, 60 s s'il est loin); « boxscore » et « right-rail »
// chaque minute, seulement si une feuille de match est ouverte (étiquette « all »). La LNH met ses réponses en cache
// 16 s : 5 s ici ajoutent au plus 5 s de délai, contre 15 s + 5 s de cache avec l'ancienne lecture du navigateur.
// Messages : {"part","at","body"} (body : JSON de la LNH tel quel) ou {"part","error"}. Envoyés seulement quand
// ils changent, plus {"part":"ping"} après 25 s sans rien. Match fini : dernier envoi complet, puis fermeture (code 1000). Pas un match du Canadien : 4404.
const UPSTREAM = "https://api-web.nhle.com";
const LIVE = new Set(["LIVE", "CRIT"]);
const DONE = new Set(["OFF", "FINAL"]);
const EVERY = { LIVE: 5_000, CRIT: 5_000, PRE: 15_000 }; // autre état (FUT) : 60 s
const SLOW_MS = 60_000;
const SLOW = ["boxscore", "right-rail"];

export class Direct {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.sent = {};   // dernier message envoyé, par partie (texte)
    this.keys = {};   // contenu de ce message (corps LNH ou erreur) : on n'envoie que ce qui change
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
    // Ce qu'on a déjà, tout de suite; sinon la lecture qui suit l'enverra à tout le monde.
    for (const [part, msg] of Object.entries(this.sent)) if (all || part === "landing") server.send(msg);
    const fresh = this.sent.landing && (!all || this.sent.boxscore);
    if (!fresh) { if (all) this.slowAt = 0; this.ctx.waitUntil(this.poll()); }
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + EVERY.LIVE);
    return new Response(null, { status: 101, webSocket: client });
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

  async get(part) {
    try {
      const r = await fetch(`${this.env.NHL_API || UPSTREAM}/v1/gamecenter/${this.gameId}/${part}`, {
        headers: { "user-agent": "tricolore (site de partisan; github.com/ciderfer/tricolore)" } });
      if (!r.ok) return { error: `LNH : HTTP ${r.status}` };
      return { text: await r.text() };
    } catch { return { error: "LNH injoignable" }; }
  }

  // Envoie une partie à ceux qui la suivent, seulement si elle a changé (l'heure de lecture n'en fait pas partie).
  send(part, { text, error }, now, tag) {
    const key = text ?? `!${error}`;
    if (this.keys[part] === key) return;
    const msg = text ? `{"part":"${part}","at":"${new Date(now).toISOString()}","body":${text}}` : JSON.stringify({ part, error });
    this.keys[part] = key;
    this.sent[part] = msg;
    this.lastSend = now;
    for (const ws of this.ctx.getWebSockets(tag)) { try { ws.send(msg); } catch { /* connexion fermée entre-temps */ } }
  }

  webSocketMessage() { /* le navigateur n'envoie rien */ }
  webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code); } catch { /* déjà fermée */ } }
  webSocketError() {}
}
