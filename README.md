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
| `scripts/fetch-data.mjs` | Récupère les données (Node 20, sans dépendance) |
| `scripts/news.mjs` | Sources de nouvelles et filtre « Canadien » |
| `data/` | `schedule.json`, `scoreboard.json`, `standings.json`, `news.json`, `meta.json` |
| `.github/workflows/data.yml` | Mise à jour des données aux 15 minutes (et sur demande) |
| `.github/workflows/pages.yml` | Déploiement sur GitHub Pages depuis `main` |
| `worker/` | Proxy Cloudflare pour le pointage en direct |

## En local

```sh
node scripts/fetch-data.mjs
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Feuille de match

Page `match.html?id=<identifiant LNH du match>` (script `match.js`). On y arrive depuis l’accueil (derniers résultats, carte du match en direct ou terminé) et depuis le calendrier (matchs joués ou en cours).

- Données : `gamecenter/<id>/landing` (pointage, période, buts, trois étoiles, pénalités), `boxscore` (gardiens, issue du match) et `right-rail` (tirs par période, statistiques d’équipe), lues par le Worker.
- En direct : mise à jour aux 15 secondes quand l’onglet est visible.
- Si le Worker ne répond pas : le pointage du calendrier du site s’affiche, avec un message clair. Les buts, tirs et autres détails ne s’affichent pas.
- Aucune photo.

## Calendrier

Page `calendrier.html` (script `calendrier.js`), onglet « Calendrier ». Elle lit `data/schedule.json`, déjà récupéré par la tâche planifiée.

- Toute la saison, groupée par mois : date et heure de l’Est, adversaire, domicile ou étranger.
- Matchs joués : V ou D, pointage du CH en premier, « Prol. » ou « T.B. ». Matchs à venir : heure et chaînes canadiennes.
- Le prochain match (même règle que l’accueil) est mis en évidence et amené à l’écran au chargement.
- Si `schedule.json` manque ou si la source est en échec dans `meta.json`, un message d’erreur s’affiche.

## Alignement et statistiques

Page `alignement.html` (script `alignement.js`), accessible par l’onglet « Alignement ».

- `data/roster.json` : `/v1/roster/MTL/current` (numéro, nom, position, date de naissance, main).
- `data/stats.json` : `/v1/club-stats/MTL/now` (patineurs : PJ, B, A, PTS, +/- ; gardiens : PJ, V, D, DP, %ARR, MOY).
- Les liens vers les photos des joueurs sont retirés des fichiers : aucune photo n’est affichée.
- L’âge est calculé à la date du jour (heure de l’Est). Les meneurs (points, buts, passes) sont calculés à partir de `stats.json`. Les égalités sont toutes nommées (deux noms au plus, puis « +N »).
- Si une source est en échec, la section concernée affiche un message d’erreur et le pied de page la nomme.

## Icône et écran d’accueil

- Icône originale (pas le logo de la LNH ni du CH), façon numéro de chandail cousu : « T » de la police Graduate en bleu, contours blanc / rouge / blanc, sur le rouge du chandail avec la bande blanc/bleu/blanc. Le T est un tracé (aucune police requise). Sources SVG dans `icons/`, générées par `scripts/icones.py`; les petits favicons sont simplifiés.
- `manifest.webmanifest` : nom « Tricolore », `display: standalone`, `start_url` et `scope` `/tricolore/`.
- Sur iPhone : Safari → Partager → « Sur l’écran d’accueil ». Barre d’état translucide au-dessus de la bande bleue.
- Aucun service worker : la page lit toujours les données fraîches.

## Worker Cloudflare (pointage en direct)

- Adresse : `https://tricolore.tricolore.workers.dev` (constante `WORKER_DEFAULT` dans `app.js`).
- Requêtes GET seulement, depuis `https://ciderfer.github.io` ou `localhost`. Chemins permis : `scoreboard/MTL/now`, `score/now` (cache 5 s), `gamecenter/<id>/landing|boxscore|right-rail` (matchs du Canadien seulement, vérifié avec `landing` ; cache 5 s en direct, 2 min si final non officiel, 1 h si officiel), `club-schedule-season/MTL/now`, `standings/now` (cache 60 s). Aucun secret.
- Déploiement manuel, depuis le dossier `worker/` (Node 22+, compte Cloudflare connecté) :

```sh
cd worker
npx wrangler login     # une seule fois
npx wrangler deploy
```

- Le Worker n’est pas déployé par GitHub Actions pour l’instant (pas de jeton d’API).
- Test local : `npx wrangler dev --port 8787` dans `worker/`, puis ouvrir le site avec `?worker=http://localhost:8787`.

## Nouvelles

Récupérées par la tâche planifiée (`scripts/news.mjs`), jamais dans le navigateur.

| Source | Flux |
| --- | --- |
| LNH.com | API de contenu de la LNH (`forge-dapi`, étiquette `teamid-8`, fr-CA) |
| La Presse | `lapresse.ca/sports/hockey/rss` |
| Journal de Montréal | `journaldemontreal.com/sports/hockey/rss.xml` |
| Radio-Canada | `ici.radio-canada.ca/rss/771` (sports) |
| Le Devoir | `ledevoir.com/rss/section/sports.xml` |

- On garde seulement **titre, source, date et lien**. Aucun résumé, aucun texte d’article, aucune image.
- Filtre : le titre doit parler du Canadien (Canadien, CH, Tricolore, Habs, Centre Bell, Martin St-Louis). Pour les flux déjà consacrés au hockey, un nom de famille de l’alignement actuel suffit aussi.
- 7 derniers jours, plus récent d’abord, doublons retirés (même lien ou même titre), au plus 3 par source et 8 au total.
- Chaque source a son état dans `meta.json` (`news.<id>.ok`). Une source en échec est affichée « Source indisponible » sur la page et dans le pied de page, et ses anciennes manchettes ne sont pas conservées.
- RDS et TVA Sports n’offrent pas de flux RSS public; ils ne sont pas inclus.
