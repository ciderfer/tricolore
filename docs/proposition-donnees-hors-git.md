# Les données hors de Git

Statut : approuvé par Frederic, codé dans la PR #45.

## Problème

`data.yml` committait `data/` sur `main` à chaque changement : 935 commits « données: mise à jour LNH » sur 978, entre 61 et 75 par jour. Le dépôt restait petit (1,5 Mo), mais les vrais changements étaient noyés, et la tâche avait besoin du droit d'écrire dans le repo.

## Ce qui change

Les données ne passent plus par Git. La tâche les publie directement sur le site.

1. Un seul workflow, `data.yml`, qui remplace `pages.yml`. On garde ce nom parce que le Worker l'appelle. Il se déclenche sur un push sur `main`, par la minuterie du Worker, par l'horaire GitHub (:08 et :38) et à la main.
2. Le cache GitHub Actions garde le dernier site publié au complet (`_publie/`), données comprises. Au début d'un passage, ses données sont copiées dans `data/`, puis `fetch-data.mjs` et `fetch-injuries.mjs` roulent comme avant.
3. `scripts/publication.mjs` compare le nouveau `_site` au site publié, fichier par fichier. On publie si un fichier diffère (données ou code), ou sur un push. Un push remplacé dans la file d'attente par un autre passage est donc publié quand même au passage suivant.
4. Garde-fou : si `data/meta.json` ou `data/schedule.json` manque ou est illisible, la tâche échoue, rien n'est publié, et le site garde la version d'avant.
5. Le cache prend le nouveau site seulement après une publication réussie. Si la publication échoue, le passage suivant voit encore la différence et réessaie.
6. `data/` sort de Git et entre dans `.gitignore`. En local, `node scripts/fetch-data.mjs` recrée tout à partir d'un dossier vide (34 fichiers, environ 1 s).
7. Le workflow n'a plus `contents: write`. Seul le job de publication a `pages: write` et `id-token: write`.

Si le cache disparaît (7 jours sans usage, ou effacé à la main), le passage suivant reconstruit tout à partir de la LNH. On perd seulement l'heure du début d'une panne en cours (`since`), donc la surveillance attend 2 h de plus avant d'avertir.

## Risques

- **Site en ligne.** Un passage publie seulement si les données essentielles sont là. Si toute la LNH est en panne, `fetch-data.mjs` échoue comme avant, et un push de code attend le prochain passage réussi pour être publié.
- **Hors ligne (`sw.js`).** Rien ne change. Les adresses `data/*.json` restent les mêmes, et la version `?v=` vient du contenu des JS et CSS. Le test qui compare `DATA` aux fichiers de `data/` roule en local, quand `data/` existe; la CI n'a plus ces fichiers.
- **Surveillance.** Le script ne change pas, il lit toujours `meta.json` sur le site. `checkedAt` avance encore au moins aux 45 min, par une publication au lieu d'un commit.
- **60 jours sans activité.** GitHub désactive un workflow avec horaire après 60 jours sans activité dans un repo public, et un workflow désactivé ignore aussi les appels du Worker. Les commits de données comptaient comme activité. Sans commit pendant 60 jours, il faut réactiver « Données LNH » et « Surveillance des données » dans l'onglet Actions.
- **Historique des données.** `git log data/` ne montre plus rien de neuf. Pour comprendre une panne, il reste `meta.json` et les journaux de la tâche (étape « Publier? »).

## Retour en arrière

1. Revert de la PR sur `main`. `pages.yml`, l'ancien `data.yml` et `data/` reviennent, dans l'état du dernier commit de données.
2. Le push du revert redéploie le site avec ces données (la page affiche « données périmées » si elles ont plus de 90 min). Le passage suivant de la tâche (au plus 15 min) recommence à committer des données fraîches.
3. Facultatif : effacer les entrées `site-publie-…` dans Actions › Caches. Elles ne servent plus, et GitHub les efface après 7 jours sans usage.

Les 935 commits de données déjà faits restent tels quels, sans réécriture de l'historique.
