# Tricolore

Le site des partisans du Canadien de Montréal : prochain match, fiche, derniers résultats et classement de la division Atlantique.
Site de partisan **non officiel**, non affilié à la LNH ni au Club de hockey Canadien.

## Principe

- Site statique (HTML, CSS, JavaScript), aucune étape de compilation.
- Données : [API publique de la LNH](https://api-web.nhle.com/v1/). Elle n’autorise pas les appels depuis un navigateur (pas d’en-tête CORS), donc une GitHub Action récupère les données aux 10 minutes et les enregistre dans `data/`.
- Aucune donnée inventée : si une source échoue, la page l’indique clairement au lieu d’afficher autre chose.
- Polices auto-hébergées : Archivo et Graduate (SIL Open Font License, voir `fonts/`).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | La page d’accueil |
| `scripts/fetch-data.mjs` | Récupère les données (Node 20, sans dépendance) |
| `data/` | `schedule.json`, `scoreboard.json`, `standings.json`, `meta.json` |
| `.github/workflows/data.yml` | Mise à jour des données aux 10 minutes (et sur demande) |
| `.github/workflows/pages.yml` | Déploiement sur GitHub Pages depuis `main` |

## En local

```sh
node scripts/fetch-data.mjs
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## À venir

- Nouvelles : manchettes de flux RSS publics (titre, source, date et lien seulement).
