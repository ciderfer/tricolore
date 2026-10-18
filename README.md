# Tricolore

Le site des partisans du Canadien de Montréal : prochain match, fiche, derniers résultats et classement de la division Atlantique.
Site de partisan **non officiel**, non affilié à la LNH ni au Club de hockey Canadien.

## Principe

- Site statique (HTML, CSS, JavaScript), aucune étape de compilation.
- Données : [API publique de la LNH](https://api-web.nhle.com/v1/). Elle n’autorise pas les appels depuis un navigateur (pas d’en-tête CORS). Deux chemins :
  - **Fichiers du site** : une GitHub Action récupère les données aux 15 minutes et les enregistre dans `data/`. La page s’affiche tout de suite avec ces fichiers.
  - **Pointage en direct** : quand un match est en cours ou commence dans moins de 30 minutes, la page interroge aux 15 secondes un petit Worker Cloudflare (`worker/`) qui relaie seulement quelques chemins de l’API LNH. Si le Worker ne répond pas, la page revient aux fichiers du site et l’indique.
- Si les fichiers du site n’ont pas été vérifiés depuis plus de 90 minutes, la page affiche un avertissement.
- Aucune donnée inventée : si une source échoue, la page l’indique clairement au lieu d’afficher autre chose.
- Polices auto-hébergées : Archivo et Graduate (SIL Open Font License, voir `fonts/`).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | La page d’accueil |
| `alignement.html`, `alignement.js` | Alignement et statistiques |
| `scripts/fetch-data.mjs` | Récupère les données (Node 20, sans dépendance) |
| `data/` | `schedule.json`, `scoreboard.json`, `standings.json`, `roster.json`, `stats.json`, `meta.json` |
| `.github/workflows/data.yml` | Mise à jour des données aux 15 minutes (et sur demande) |
| `.github/workflows/pages.yml` | Déploiement sur GitHub Pages depuis `main` |
| `worker/` | Proxy Cloudflare pour le pointage en direct |

## En local

```sh
node scripts/fetch-data.mjs
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Alignement et statistiques

- `data/roster.json` : `/v1/roster/MTL/current` (numéro, nom, position, date de naissance, main).
- `data/stats.json` : `/v1/club-stats/MTL/now` (patineurs : PJ, B, A, PTS, +/- ; gardiens : PJ, V, D, DP, %ARR, MOY).
- Les liens vers les photos des joueurs sont retirés des fichiers : aucune photo n’est affichée.
- L’âge est calculé à la date du jour (heure de l’Est). Les meneurs (points, buts, passes) sont calculés à partir de `stats.json`. Les égalités sont toutes nommées (deux noms au plus, puis « +N »).
- Si une source est en échec, la section concernée affiche un message d’erreur et le pied de page la nomme.

## Worker Cloudflare (pointage en direct)

- Adresse : `https://tricolore.tricolore.workers.dev` (constante `WORKER_DEFAULT` dans `app.js`).
- Requêtes GET seulement, depuis `https://ciderfer.github.io` ou `localhost`. Chemins permis : `scoreboard/MTL/now`, `score/now`, `gamecenter/<id>/landing|boxscore` (cache 5 s), `club-schedule-season/MTL/now`, `standings/now` (cache 60 s). Aucun secret.
- Déploiement manuel, depuis le dossier `worker/` (Node 22+, compte Cloudflare connecté) :

```sh
cd worker
npx wrangler login     # une seule fois
npx wrangler deploy
```

- Le Worker n’est pas déployé par GitHub Actions pour l’instant (pas de jeton d’API).
- Test local : `npx wrangler dev --port 8787` dans `worker/`, puis ouvrir le site avec `?worker=http://localhost:8787`.

## À venir

- Nouvelles : manchettes de flux RSS publics (titre, source, date et lien seulement).
