# Covoiturage 4.8.4 — choix du conducteur avant 7h

- Avant l'heure de validation (7h le jour du trajet), chacun peut seulement se désigner **lui-même** conducteur de son groupe. Il n'est plus possible d'imposer le volant à un autre membre.
- À partir de 7h (et pour les dates passées), le conducteur peut de nouveau être changé librement parmi les membres du groupe.
- La règle s'applique sur l'onglet « Prochain » et sur la page « Groupes » : les autres noms sont grisés et un message explique la règle. Elle est revérifiée au moment de l'enregistrement.
- Un membre extérieur au groupe ne peut pas en changer le conducteur avant 7h.
- La suggestion automatique de conducteur (rotation) est inchangée.
- Aucun changement de configuration Firebase ni de données stockées.

Scénario couvert : conducteur proposé Aurélien, Étienne tente de mettre Stéphane avant 7h → refusé ; Étienne se met lui-même → accepté ; après 7h → changement libre.
