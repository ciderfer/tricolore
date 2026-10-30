// Tricolore — suite des envois d'alertes : un Durable Object « Envoi » (liaison ENVOI, un seul objet, « alertes »).
//
// Pourquoi : plan gratuit, 50 sous-requêtes par exécution. La minuterie envoie les BATCH premières alertes et confie
// le reste ici (POST, une liste [{ s, ev }]). L'objet range la liste en lots de BATCH (« q:<rang> », dans l'ordre)
// et envoie un lot par alarme, puis relance aussitôt l'alarme : chaque alarme est une exécution à part, avec ses
// propres 50 sous-requêtes. 500 appareils : environ 12 lots, quelques secondes. Rien d'autre n'est gardé.
import { BATCH, sendBatch } from "./alertes.js";

export class Envoi {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
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
