# Tricolore

Le site des partisans du Canadien de Montréal : prochain match, fiche, derniers résultats et classement de la division Atlantique.
Site de partisan **non officiel**, non affilié à la LNH ni au Club de hockey Canadien.

## Principe

- Site statique (HTML, CSS, JavaScript), aucune étape de compilation.
- Données : [API publique de la LNH](https://api-web.nhle.com/v1/). Elle n’autorise pas les appels depuis un navigateur (pas d’en-tête CORS). Deux chemins :
  - **Fichiers du site** : une GitHub Action récupère les données aux 15 minutes et les enregistre dans `data/`. Elle est lancée par la minuterie du Worker Cloudflare (l’horaire de GitHub Actions saute la plupart des exécutions et ne sert plus que de filet de sécurité). La page s’affiche tout de suite avec ces fichiers.
  - **Pointage en direct** : quand un match est en cours ou commence dans moins de 30 minutes, la page ouvre une connexion WebSocket vers un petit Worker Cloudflare (`worker/`) : un Durable Object par match lit l’API LNH aux 5 secondes pour tout le monde et pousse chaque changement (`worker/direct.js`), ce qui tient des milliers de partisans dans le quota gratuit. Si la connexion ne s’ouvre pas, la page interroge le Worker aux 15 secondes comme avant; si le Worker ne répond pas, elle revient aux fichiers du site et l’indique.
  - **Dernier but** (carte du match en direct ou terminé de l’accueil, données du Worker seulement) : par exemple « But de Caufield (5), à 11:45 de la 2e période » (temps écoulé dans la période). Si le pointage compte plus de buts que le sommaire de la LNH, la carte affiche « Détails du but en attente de la LNH » plutôt que le but précédent. Un nouveau but est annoncé aux lecteurs d’écran (zone `aria-live`).
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
| `.github/workflows/surveillance.yml`, `scripts/surveillance.mjs`, `scripts/etat.mjs` | Surveillance des données : ouvre une issue GitHub (donc un courriel) si le site n’a pas vérifié ses données depuis 90 min ou si une source de la LNH est en échec depuis plus de 2 h, et la ferme au retour à la normale. Voir « Surveillance » plus bas |
| `tests/` | Tests de la logique pure (surveillance, dernier but) : `node --test tests/*.test.mjs` |
| `.github/dependabot.yml` | Mises à jour hebdomadaires des actions GitHub, fixées par SHA dans les workflows |
| `worker/` | Proxy Cloudflare pour le pointage en direct, minuterie chaque minute (tâche de données aux 15 minutes, secret `GH_TOKEN` : jeton GitHub limité à ce repo, permission Actions en écriture; alertes de match) et envoi Web Push (`alertes.js`, `push.js`; tests : `npm test`) |
| `alertes.html`, `alertes.js`, `alertes.css`, `sw.js` | Page « Alertes de match » (lien au bas des pages) et service worker des notifications |

## En local

```sh
node scripts/fetch-data.mjs
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Surveillance

- `.github/workflows/surveillance.yml` lit `data/meta.json` sur le site publié (horaire de GitHub aux :23 et :53, et sur demande).
- Problème si : `checkedAt` a plus de 90 min, une source de la LNH (`sources.*`) est en échec depuis plus de 2 h (champ `since`, noté par `fetch-data.mjs` au début de la panne), ou `meta.json` est illisible après 3 essais.
- Une seule issue « Tricolore : données en panne » à la fois, qui mentionne @ciderfer. Tant que le problème dure, son texte est mis à jour sans nouveau courriel. Au retour à la normale, un commentaire est ajouté et l’issue est fermée.
- Les sources de nouvelles ne sont pas surveillées (un flux RSS en panne n’empêche pas le site de fonctionner).
- Essai en local, sans toucher aux issues : `node scripts/surveillance.mjs` (sans `GITHUB_TOKEN`, le script affiche seulement son diagnostic).

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
- Service worker `sw.js` (portée `/tricolore/`) seulement pour les alertes de match : `push` et `notificationclick`, aucun gestionnaire `fetch`, donc aucune mise en cache; les pages lisent toujours les données fraîches.
- Politique de sécurité du contenu (balise `Content-Security-Policy` dans chaque page) : scripts, styles et polices du site seulement, connexions au site et au Worker (et à `localhost` pour les tests). Aucun style ni script en ligne.

## Alertes de match (iPhone)

Page `alertes.html` (lien « Alertes de match » au bas des pages). Notifications Web Push pour les matchs du Canadien : « Le match commence », chaque but (les deux équipes : marqueur, pointage, période) et le final. Cases à cocher pour chaque type.

- iPhone : iOS 16.4 ou plus récent, et **seulement depuis l’icône de l’écran d’accueil**. Dans Safari, la page affiche les étapes (Share › Add to Home Screen) au lieu du bouton.
- Le Worker (minuterie chaque minute) lit `scoreboard/MTL/now`, plus `gamecenter/<id>/landing` seulement pendant un match ou juste après. Les messages ne reprennent que ce que l’API LNH rend.
- Abonnements dans le KV `ALERTES` (une clé par appareil, tout dans les métadonnées); état des envois dans la clé `etat`. La minuterie n’écrit que lorsqu’une alerte part (environ 10 écritures par match, limite gratuite : 1 000 par jour). Abonnement expiré (404 ou 410) : retiré au premier envoi. Au plus 40 appareils (limite gratuite de 50 sous-requêtes par exécution).
- Chiffrement (RFC 8291, `aes128gcm`) et jeton VAPID (RFC 8292, ES256) faits avec WebCrypto, sans dépendance (`worker/push.js`).
- Mise en place (faite le 20 octobre 2026; à refaire seulement pour changer les clés VAPID, ce qui oblige chaque appareil à se réabonner), dans `worker/` :

```sh
npx wrangler kv namespace create ALERTES      # puis mettre l’id affiché dans wrangler.toml
node vapid-keys.mjs                           # affiche une paire de clés VAPID
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT         # mailto:adresse@exemple.com
npm test && npm run deploy
```

- Test local : `node vapid-keys.mjs --dev-vars > .dev.vars` (fichier ignoré par git), `npx wrangler dev --test-scheduled`, site ouvert avec `?worker=http://localhost:8787`, minuterie déclenchée par `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`. `NHL_API` (dans `.dev.vars`) peut pointer vers une fausse API LNH, et `PUSH_DEV=1` permet un faux service de push sur localhost.

## Worker Cloudflare (pointage en direct)

- Adresse : `https://tricolore.tricolore.workers.dev` (constante `WORKER_DEFAULT` dans `app.js`).
- Requêtes GET seulement (sauf `POST /push/subscribe` et `POST /push/unsubscribe`, voir Alertes de match), depuis `https://ciderfer.github.io` ou `localhost`. Au plus 300 requêtes par minute par adresse IP (liaison `LIMITE` de `wrangler.toml`), sinon réponse 429. Chemins permis : `scoreboard/MTL/now`, `score/now` (cache 5 s), `gamecenter/<id>/landing|boxscore|right-rail` (matchs du Canadien seulement, vérifié avec `landing` ; cache 5 s en direct, 2 min si final non officiel, 1 h si officiel), `club-schedule-season/MTL/now`, `standings/now` (cache 60 s). Aucun secret.
- Déploiement manuel, depuis le dossier `worker/` (Node 22+, compte Cloudflare connecté). La version de wrangler est fixée dans `worker/package.json` :

```sh
cd worker
npm ci                 # installe la version fixée de wrangler
npx wrangler login     # une seule fois
npm run deploy
```

- Le Worker n’est pas déployé par GitHub Actions pour l’instant (pas de jeton d’API).
- Test local : `npm run dev` dans `worker/`, puis ouvrir le site avec `?worker=http://localhost:8787`.
- Le `GH_TOKEN` du Worker expire le **dimanche 17 janvier 2027**. Le renouveler avant cette date dans GitHub › Settings › Developer settings › Fine-grained tokens, puis faire `npx wrangler secret put GH_TOKEN` dans `worker/`. S’il expire, la minuterie échoue sans avertissement; l’horaire GitHub (:08 et :38) prend le relais, moins fiable.

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
