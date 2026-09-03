# Covoiturage 4.4.0-beta.8

- Le bouton de test individuel des notifications est maintenant disponible pour tout utilisateur réel ayant activé **Rappel de saisie**.
- Libellé : **🔔 Tester sur cet appareil**.
- En production, le bouton teste uniquement l’appareil courant et le bouton technique **Copier le jeton FCM** reste masqué.
- En mode TEST, le test de notification reste lié au profil Firebase réel (Igor) et n’est pas proposé lorsqu’un autre utilisateur est seulement simulé.
- La notification locale affiche `Covoiturage` en production et `Covoiturage · TEST` dans l’environnement TEST.
