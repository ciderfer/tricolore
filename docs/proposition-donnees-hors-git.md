# Proposition : les données hors de Git

Statut : à valider par Frederic. Rien n'est codé.

## Problème

`data.yml` committe `data/` sur `main` à chaque changement. Ça donne 935 commits « données: mise à jour LNH » sur 978, entre 61 et 75 par jour. Le dépôt reste petit (1,5 Mo), mais les vrais changements sont noyés, et la tâche a besoin du droit d'écrire dans le repo.

## Option proposée

Les données ne passent plus par Git. La tâche les publie directement sur le site.

1. Un seul workflow, `data.yml`, qui remplace `pages.yml`. On garde ce nom parce que le Worker l'appelle. Il se déclenche sur un push sur `main`, par la minuterie du Worker, par l'horaire GitHub et à la main.
2. Étapes : checkout, puis `data/` restauré du cache GitHub Actions (le dernier passage), puis `fetch-data.mjs` et `fetch-injuries.mjs`. Si `data/` a changé, ou si c'est un push, le workflow construit `_site` comme aujourd'hui et le publie. À la fin, il sauvegarde `data/` dans le cache.
3. `data/` sort de `main` et entre dans `.gitignore`. En local, `node scripts/fetch-data.mjs` recrée tout. Vérifié : à partir d'un dossier vide, 34 fichiers en 1,3 s, les mêmes que dans le repo.
4. `data.yml` n'a plus besoin de `contents: write`.
5. Garde-fou : pas de publication si `data/meta.json` ou `data/schedule.json` manque. La tâche échoue, et le site garde la version d'avant.

Le cache garde aussi les 25 fiches de `data/joueurs/` sans qu'on ait à les lister. Si le cache disparaît (7 jours sans usage, ou effacé à la main), le passage suivant reconstruit tout à partir de la LNH. On perd seulement l'heure du début d'une panne en cours (`since`), donc la surveillance attend 2 h de plus avant d'avertir.

## Risques

- **Site en ligne.** Un push de code dépend maintenant du cache, ou de la LNH si le cache est vide. Le garde-fou empêche de publier un site sans données. GitHub Pages garde la dernière version publiée tant qu'une publication ne réussit pas.
- **Hors ligne (`sw.js`).** Rien ne change. Les adresses `data/*.json` restent les mêmes, et la version `?v=` vient du contenu des JS et CSS, pas des données.
- **Surveillance.** Le script ne change pas, il lit toujours `meta.json` sur le site. `checkedAt` avance encore au moins aux 45 min, par une publication au lieu d'un commit.
- **Push et passage de données en même temps.** Un seul workflow, un seul groupe `concurrency` : ils passent un à la fois.
- **Historique des données.** `git log data/` ne montre plus rien de neuf. Pour comprendre une panne, il reste `meta.json` et les journaux de la tâche.

## Retour en arrière

Revert de la PR. `data/` revient sur `main` dans l'état du dernier commit, et le passage suivant recommence à committer des données fraîches. Les 935 commits déjà faits restent tels quels, sans réécriture de l'historique.

## Option écartée

Committer les données sur une branche à part (`donnees`). C'est un peu moins de travail, mais Git reste la base de données, ailleurs.
