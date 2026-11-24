# Covoiturage 4.8.5 — « Pas de voiture » pour la journée

- Sur l'onglet « Prochain », une case **« Pas de voiture ce jour-là »** apparaît uniquement quand le statut est Présent ou Impératif. Elle ne vaut que pour ce jour.
- Le statut reste le même ; l'équipe voit simplement « Présent · sans voiture » (ou « Impératif 16:30 · sans voiture »).
- Une personne sans voiture n'est jamais proposée comme conducteur et est grisée dans la liste du conducteur (Prochain et Groupes).
- Si le conducteur prévu déclare « pas de voiture », il est remplacé automatiquement par la suggestion parmi les membres qui ont une voiture ; la composition du groupe est conservée.
- La répartition automatique ne forme jamais un groupe sans aucune voiture et évite de laisser seule une personne sans voiture.
- La validation refuse un conducteur sans voiture, y compris après relecture sur le serveur juste avant l'enregistrement.
- Équité : les compteurs ne changent pas. Une personne qui ne conduit pas faute de voiture redevient prioritaire au trajet suivant.
- Delle : Igor ou Ludo sans voiture ne peut pas être conducteur jusqu'à Delle ; si aucun des deux n'a de voiture, le trajet Delle est bloqué avec un message.
- Les dates passées (saisie a posteriori) restent libres.
- Aucun changement de règles Firestore : simple champ `noCar` sur la saisie du jour.

Limite : l'historique compacté des mois précédents ne conserve pas l'information « sans voiture » (sans effet, les dates passées étant libres).
