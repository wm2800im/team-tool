# Covoiturage — production

Application web (PWA) de covoiturage de l'équipe, publiée par GitHub Pages depuis `main` :
https://wm2800im.github.io/team-tool/

Les évolutions sont d'abord essayées dans le dépôt `team-tool-test` (Firebase TEST), puis reportées ici.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | Application |
| `public-config.js` | Configuration Firebase PROD et numéro de version |
| `quota-core.mjs` | Historique compacté (économie de lectures Firestore) |
| `service-worker.js`, `firebase-messaging-sw.js`, `manifest.webmanifest` | Mise en cache, notifications, installation |
| `notify-runner.mjs`, `notify-core.mjs` | Envoi des rappels de 20h et des notifications de test |
| `firestore.rules.prod-4.4.0.txt` | Copie de référence des règles Firestore (voir ci-dessous) |
| `tests/` | Scénarios automatiques (`node --test tests/*.test.mjs`) |
| `changements/` | Notes de version |

## Publier une version

1. Modifier le code, augmenter la version dans `public-config.js` **et** `service-worker.js`.
2. Ajouter `changements/CHANGEMENTS_<version>.md`.
3. Pousser sur `main` : GitHub vérifie la syntaxe, la configuration PROD et les tests, puis Pages publie en quelques minutes.

## Règles Firestore

Les règles actives sont celles publiées dans la console Firebase (projet `team-tool-data`). La copie `firestore.rules.prod-4.4.0.txt` ne contient pas la collection privée `delleTrips` : avant toute republication, repartir des règles affichées dans la console, jamais de ce seul fichier.

## Notifications

Le workflow `.github/workflows/notifications.yml` lance `notify-runner.mjs` :
- entre 20h et 22h52 (heure de Paris), il rappelle à ceux qui ont activé le rappel de renseigner leur statut du lendemain (jours travaillés uniquement, un seul rappel par personne et par jour) ;
- en journée, il envoie les notifications de test demandées depuis Admin.

Le journal de chaque passage (onglet Actions) indique pour chaque personne pourquoi un rappel est envoyé ou non. Il utilise le secret `FIREBASE_SERVICE_ACCOUNT_JSON`.

GitHub ne garantit pas l'heure des tâches planifiées. Pour des rappels garantis, un déclencheur externe peut appeler « Run workflow » (workflow_dispatch) à heure fixe.
