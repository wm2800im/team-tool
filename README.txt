TEAM TOOL — mise à jour bilan + Prochain + saisie a posteriori

Nouveautés :
- L’onglet « Prochain » affiche le jour courant avant 09:00, puis le prochain jour ouvré à partir de 09:00.
- Sur une date passée, les 5 covoitureurs peuvent être sélectionnés librement dans Groupes, même si un statut Présent n’avait pas été saisi.
- Le bilan sait exploiter les anciens statuts Excel importés : absent, seul, ou « absent ou seul » selon la période.
- Import privé des statuts historiques via Admin > Complément d’historique Excel.

MISE À JOUR :
1. Dans Firebase > Firestore > Règles, remplacer les règles par firestore.rules.final.txt et publier.
2. Sur GitHub, remplacer les fichiers de l’application par ceux de ce dossier (NE PAS envoyer legacy_status_import.json sur GitHub).
3. Attendre la mise à jour de GitHub Pages puis ouvrir l’application avec le profil Igor.
4. Admin > Complément d’historique Excel > sélectionner le fichier legacy_status_import.json fourni séparément.
5. Attendre « Import terminé » puis vérifier Mon bilan > Depuis le début.

IMPORTANT : legacy_status_import.json contient des données historiques et doit rester privé (OneDrive ou PC). Il n’a pas à être mis sur GitHub.
