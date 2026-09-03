# Covoiturage — 4.4.0-beta.2

## Écran Prochain
- Recomposition compacte inspirée du croquis utilisateur.
- Les 4 statuts restent immédiatement accessibles en haut.
- Vue centrale en 2 colonnes : « Mon prochain » / « Situation du groupe ».
- Proposition de covoiturage directement sous ces deux colonnes.
- Mise en page mobile resserrée pour limiter fortement le défilement.

## Validation du covoiturage
- Retour visuel immédiat pendant l'enregistrement.
- Après validation : bloc vert « Covoiturage validé » avec groupe, conducteur et passagers.
- Le bouton devient « Trajet validé » et est désactivé lorsque le trajet affiché correspond déjà au trajet enregistré.
- Si le conducteur ou le groupe est modifié ensuite, le bouton devient « Mettre à jour le trajet ».
- Le bouton « Modifier » reste disponible.

## Performances / réactivité
- Le thème Clair/Sombre/Auto s'applique immédiatement, puis Firebase est mis à jour en arrière-plan.
- Les statuts Présent/Absent/Seul s'affichent immédiatement avant confirmation Firebase.
- Les réponses de compatibilité horaire s'affichent immédiatement.
- Le choix du conducteur est optimiste : interface d'abord, synchronisation ensuite.
- « Modifier » dans l'historique ouvre immédiatement le trajet ; l'écriture du plan se fait ensuite en arrière-plan.
- Les listeners Firestore ne redessinent plus toutes les pages à chaque modification : seules les vues concernées sont rafraîchies.
- Calcul des compteurs de l'historique optimisé en une seule passe au lieu de recalculs répétés pour chaque ligne.

## Version
- TEST : 4.4.0-beta.2
- Aucun changement des règles Firebase nécessaire par rapport à beta.1.
