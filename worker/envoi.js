// Tricolore — suite des envois d'alertes : un Durable Object « Envoi » (liaison ENVOI, un seul objet, « alertes »).
//
// Pourquoi : plan gratuit, 50 sous-requêtes par exécution. La minuterie envoie les BATCH premières alertes et confie
// le reste ici (POST, une liste [{ s, ev }]). L'objet range la liste en lots de BATCH (« q:<rang> », dans l'ordre)
// et envoie un lot par alarme, puis relance aussitôt l'alarme : chaque alarme est une exécution à part, avec ses
// propres 50 sous-requêtes. 500 appareils : environ 12 lots, quelques secondes. Rien d'autre n'est gardé.
// Il garde aussi « etat » (ce qui a déjà été annoncé, voir alertes.js) : POST /etat { game, landing } lit, décide
// (detect) et note l'état d'un bloc, une requête à la fois, et rend les événements à envoyer.
import { BATCH, sendBatch, detect, noteRec } from "./alertes.js";

export class Envoi {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
    if (new URL(request.url).pathname === "/etat") return Response.json(await this.etat(await request.json()));
    const items = await request.json();
    if (!Array.isArray(items)) return new Response("liste attendue", { status: 400 });
    let n = (await this.ctx.storage.get("n")) || 0;
    for (let i = 0; i < items.length; i += BATCH) {
      await this.ctx.storage.put(`q:${String(n++).padStart(12, "0")}`, items.slice(i, i + BATCH));
    }
    await this.ctx.storage.put("n", n);
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 204 });
  }

  // blockConcurrencyWhile : aucune autre requête entre la lecture et l'écriture, même pendant la lecture du KV.
  etat({ game, landing }) {
    return this.ctx.blockConcurrencyWhile(async () => {
      let etat = await this.ctx.storage.get("etat");
      // Rien encore ici : on part de l'ancien « etat » du KV (match en cours sans doublon), jusqu'au premier événement noté.
      if (etat === undefined) etat = (await this.env.ALERTES.get("etat", "json")) || { g: {} };
      const { events, rec } = detect(game, landing, etat.g?.[game.id] || null);
      if (rec) await this.ctx.storage.put("etat", noteRec(etat, game.id, rec));
      return events;
    });
  }

  // Un lot par alarme. Retiré après l'envoi; s'il en reste, prochaine alarme tout de suite.
  async alarm() {
    const q = await this.ctx.storage.list({ prefix: "q:", limit: 2 });
    const [first] = q;
    if (!first) return;
    const r = await sendBatch(this.env, first[1]);
    console.log("envoi", JSON.stringify({ lot: first[0], ...r }));
    await this.ctx.storage.delete(first[0]);
    if (q.size > 1) await this.ctx.storage.setAlarm(Date.now());
  }
}
