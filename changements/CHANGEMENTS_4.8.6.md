# Covoiturage 4.8.6 — rappels du soir fiabilisés, dépôt nettoyé

- Rappels de 20h : GitHub ne lançait le script « toutes les 5 minutes » que 3 à 4 fois par jour, à des heures aléatoires ; le rappel tombait rarement dans la fenêtre 20h–23h (aucun du 19 au 23 novembre). Le script est maintenant planifié à 16 horaires précis entre 20h et 22h52 (heure de Paris, hiver comme été), plus un passage par heure en journée pour les notifications de test.
- Journal lisible à chaque passage : pour chacun, « rappel envoyé », « statut déjà renseigné », « rappel désactivé », « déjà envoyé » ou « aucun appareil actif ».
- Logique des rappels isolée dans `notify-core.mjs` et testée (fenêtre, date visée, calendrier, décisions, couverture de la planification).
- Nettoyage : suppression des outils ponctuels déjà utilisés (réparation des binômes, export TEST), de fichiers de règles Firestore périmés, d'un doublon du workflow, de `firebase-config.js` inutilisé et des anciennes notes de mise à jour. Notes de version regroupées dans `changements/`. README à jour.
- Aucun changement de l'application ni des règles Firestore.
