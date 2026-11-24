# Covoiturage 4.8.3 — correction de la composition des groupes

- Une répartition enregistrée manuellement reste prioritaire tant que ses participants sont disponibles et que sa composition est cohérente.
- Si un membre passe « Seul » ou « Absent », la proposition est automatiquement reconstruite parmi les présents ; une personne redevenue présente depuis la dernière modification est également prise en compte.
- Le conducteur choisi manuellement est conservé lorsque sa nouvelle composition recoupe au moins deux membres de l'ancien groupe.
- La page Groupes utilise la même proposition actualisée pour la modifier ou la valider.
- La validation relit les disponibilités et les réponses aux impératifs sur le serveur immédiatement avant l'enregistrement ; elle refuse un groupe devenu incompatible.
- Les corrections historiques restent possibles malgré les statuts du jour.
- Le module privé Delle utilise la répartition actualisée. Aucun changement de configuration Firebase ou de données métier stockées.
- Aucun bouton nouveau ; correctif appliqué uniquement au code de production.

Scénarios couverts : Ludo « Seul », Ludo « Absent », Aurélien redevenu présent, conservation du conducteur Stéphane, maintien d'un plan manuel valide et saisie historique.
