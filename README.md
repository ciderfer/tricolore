# Tricolore

Le site des partisans du Canadien de Montréal : prochain match, fiche, derniers résultats et classement de la division Atlantique.
Site de partisan **non officiel**, non affilié à la LNH ni au Club de hockey Canadien.

## Principe

- Site statique (HTML, CSS, JavaScript), aucune étape de compilation.
- Données : [API publique de la LNH](https://api-web.nhle.com/v1/). Elle n’autorise pas les appels depuis un navigateur (pas d’en-tête CORS). Deux chemins :
  - **Fichiers du site** : une GitHub Action récupère les données aux 15 minutes et les enregistre dans `data/`. Elle est lancée par la minuterie du Worker Cloudflare (l’horaire de GitHub Actions saute la plupart des exécutions et ne sert plus que de filet de sécurité). La page s’affiche tout de suite avec ces fichiers.
  - **Pointage en direct** : quand un match est en cours ou commence dans moins de 30 minutes, la page interroge aux 15 secondes un petit Worker Cloudflare (`worker/`) qui relaie seulement quelques chemins de l’API LNH. Si le Worker ne répond pas, la page revient aux fichiers du site et l’indique.
- Si les fichiers du site n’ont pas été vérifiés depuis plus de 90 minutes, la page affiche un avertissement.
- Aucune donnée inventée : si une source échoue, la page l’indique clairement au lieu d’afficher autre chose.
- Polices auto-hébergées : Archivo et Graduate (SIL Open Font License, voir `fonts/`).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | La page d’accueil |
| `commun.js` | Fonctions communes aux 5 pages (échappement, dates, chargement de `data/` avec `meta.json`, pied de page), chargé avant le script de chaque page |
| `scripts/fetch-data.mjs` | Récupère les données (Node 20, sans dépendance) |
| `scripts/news.mjs` | Sources de nouvelles et filtre « Canadien » |
| `data/` | `schedule.json`, `scoreboard.json`, `standings.json`, `news.json`, `meta.json` |
| `.github/workflows/data.yml` | Mise à jour des données aux 15 minutes (et sur demande) |
| `.github/workflows/pages.yml` | Déploiement sur GitHub Pages depuis `main`. Ajoute `?v=<empreinte>` aux JS et CSS dans le HTML (empreinte du contenu du code) pour que les navigateurs ne gardent pas un ancien fichier après un déploiement |
| `.github/dependabot.yml` | Mises à jour hebdomadaires des actions GitHub, fixées par SHA dans les workflows |
| `worker/` | Proxy Cloudflare pour le pointage en direct, et minuterie qui lance la tâche de données aux 15 minutes (secret `GH_TOKEN` : jeton GitHub limité à ce repo, permission Actions en écriture) |

## En local

```sh
node scripts/fetch-data.mjs
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Feuille de match

Page `match.html?id=<identifiant LNH du match>` (script `match.js`). On y arrive depuis l’accueil (derniers résultats, carte du match en direct ou terminé) et depuis le calendrier (matchs joués ou en cours).

- Données : `gamecenter/<id>/landing` (pointage, période, buts, trois étoiles, pénalités), `boxscore` (gardiens, issue du match) et `right-rail` (tirs par période, statistiques d’équipe), lues par le Worker.
- En direct, quand l’onglet est visible : pointage, buts et pénalités (`landing`) aux 15 secondes; gardiens, tirs et statistiques (`boxscore`, `right-rail`) chaque minute, pour ménager le quota du Worker. La page l’indique sous ces sections, avec l’heure de la dernière lecture. Quand le match n’est plus en direct (fin du match), tout est relu une dernière fois.
- Si le Worker ne répond pas : le pointage du calendrier du site s’affiche, avec un message clair. Les buts, tirs et autres détails ne s’affichent pas.
- Aucune photo.

## Calendrier

Page `calendrier.html` (script `calendrier.js`), onglet « Calendrier ». Elle lit `data/schedule.json`, déjà récupéré par la tâche planifiée.

- Toute la saison, groupée par mois : date et heure de l’Est, adversaire, domicile ou étranger.
- Matchs joués : V ou D, pointage du CH en premier, « Prol. » ou « T.B. ». Matchs à venir : heure et chaînes canadiennes.
- Le prochain match (même règle que l’accueil) est mis en évidence et amené à l’écran au chargement.
- Si `schedule.json` manque ou si la source est en échec dans `meta.json`, un message d’erreur s’affiche.

## Calendrier à s’abonner (.ics)

- `data/canadiens.ics`, écrit par la tâche planifiée (`scripts/ics.mjs`) à partir de `schedule.json` : saison régulière et séries (pas les matchs préparatoires).
- Abonnement iPhone : bouton « Ajouter à mon calendrier » de la page Calendrier (`webcal://ciderfer.github.io/tricolore/data/canadiens.ics`). Le fichier peut aussi être téléchargé.
- Un événement par match : « Sharks @ Canadiens », heures en UTC (affichées à l’heure locale), durée 2 h 45, aréna et ville, télé, pointage final une fois le match joué, lien vers la feuille de match. UID stable (identifiant LNH) : pas de doublon aux mises à jour.
- Le fichier n’est réécrit que si un match change (les DTSTAMP ne comptent pas dans la comparaison).

## Alignement et statistiques

Page `alignement.html` (script `alignement.js`), accessible par l’onglet « Alignement ».

- `data/roster.json` : `/v1/roster/MTL/current` (numéro, nom, position, date de naissance, main).
- `data/stats.json` : `/v1/club-stats/MTL/now` (patineurs : PJ, B, A, PTS, +/- ; gardiens : PJ, V, D, DP, %ARR, MOY).
- Les liens vers les photos des joueurs sont retirés des fichiers : aucune photo n’est affichée.
- L’âge est calculé à la date du jour (heure de l’Est). Les meneurs (points, buts, passes) sont calculés à partir de `stats.json`. Les égalités sont toutes nommées (deux noms au plus, puis « +N »).
- Si une source est en échec, la section concernée affiche un message d’erreur et le pied de page la nomme.

## Fiches de joueurs

Page `joueur.html?id=NUMÉRO` (script `joueur.js`). Chaque nom de l’alignement (et des tableaux de statistiques, pour les joueurs de l’alignement actuel) y mène.

- `data/joueurs/<id>.json` : `/v1/player/<id>/landing`, écrit par la tâche de données (`scripts/joueurs.mjs`) pour chaque joueur de `roster.json`. Seuls les champs affichés sont gardés (aucun lien de photo). Un fichier n’est réécrit que s’il change ; la fiche d’un joueur qui quitte l’alignement est supprimée.
- La page affiche : numéro, nom, position, âge, main, lieu de naissance, taille et poids (métrique d’abord), statistiques de la saison en cours dans la LNH, 5 derniers matchs et totaux en carrière dans la LNH.
- Si la fiche d’un joueur n’a pas pu être récupérée, `meta.json` le note (`joueurs.failed`) et la page affiche un message d’erreur au lieu de chiffres possiblement périmés.

## Icône et écran d’accueil

- Icône originale (pas le logo de la LNH ni du CH), façon numéro de chandail cousu : « T » de la police Graduate en bleu, contours blanc / rouge / blanc, sur le rouge du chandail avec la bande blanc/bleu/blanc. Le T est un tracé (aucune police requise). Sources SVG dans `icons/`, générées par `scripts/icones.py`; les petits favicons sont simplifiés.
- `manifest.webmanifest` : nom « Tricolore », `display: standalone`, `start_url` et `scope` `/tricolore/`.
- Sur iPhone : Safari → Partager → « Sur l’écran d’accueil ». Barre d’état translucide au-dessus de la bande bleue.
- Aucun service worker : la page lit toujours les données fraîches.
- Politique de sécurité du contenu (balise `Content-Security-Policy` dans chaque page) : scripts, styles et polices du site seulement, connexions au site et au Worker (et à `localhost` pour les tests). Aucun style ni script en ligne.

## Worker Cloudflare (pointage en direct)

- Adresse : `https://tricolore.tricolore.workers.dev` (constante `WORKER_DEFAULT` dans `app.js`).
- Requêtes GET seulement, depuis `https://ciderfer.github.io` ou `localhost`. Au plus 300 requêtes par minute par adresse IP (liaison `LIMITE` de `wrangler.toml`), sinon réponse 429. Chemins permis : `scoreboard/MTL/now`, `score/now` (cache 5 s), `gamecenter/<id>/landing|boxscore|right-rail` (matchs du Canadien seulement, vérifié avec `landing` ; cache 5 s en direct, 2 min si final non officiel, 1 h si officiel), `club-schedule-season/MTL/now`, `standings/now` (cache 60 s). Aucun secret.
- Déploiement manuel, depuis le dossier `worker/` (Node 22+, compte Cloudflare connecté). La version de wrangler est fixée dans `worker/package.json` :

```sh
cd worker
npm ci                 # installe la version fixée de wrangler
npx wrangler login     # une seule fois
npm run deploy
```

- Le Worker n’est pas déployé par GitHub Actions pour l’instant (pas de jeton d’API).
- Test local : `npm run dev` dans `worker/`, puis ouvrir le site avec `?worker=http://localhost:8787`.
- Jeton `GH_TOKEN` : expire le **2027-01-17** (créé le 2026-10-19, durée de 90 jours). À renouveler avant cette date (GitHub › Settings › Developer settings › Fine-grained tokens), puis `npx wrangler secret put GH_TOKEN` dans `worker/`. S’il expire, la minuterie échoue sans avertissement; l’horaire GitHub (:08 et :38) prend le relais, moins fiable.

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
