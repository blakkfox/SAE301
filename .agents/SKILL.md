---
trigger: always_on
---

# Architecture MVC

Tout le code de l'application vit dans `script.js`, réparti en trois objets globaux `M`, `V`, `C`.
En cas de doute sur l'emplacement d'une fonction, s'arrêter et demander.

- **M (Modèle)** : données (`M.characters`) et fonctions qui les lisent, filtrent ou transforment.
  Retourne des données, jamais du HTML. Jamais de référence à `V`, jamais d'accès au DOM
  (`document`, `window`, éléments, événements).
- **V (Vue)** : seul endroit qui touche au DOM. `V.formatOne...` remplit un template et retourne
  une chaîne ; `V.render...(data)` affiche les données reçues en paramètre ; `V.init()` associe
  chaque événement à une méthode de `C`. Jamais de référence à `M`, aucune logique métier.
- **C (Contrôleur)** : seul objet qui référence à la fois `M` et `V`. `C.init()` est l'unique point
  d'entrée (dernière ligne du script). `C.handler_<action>(ev)` lit `ev`, interroge `M`, appelle `V`.
  Aucun accès au DOM hors de `ev`, aucune donnée stockée dans `C`.

Un nouveau besoin se découpe toujours ainsi : donnée ou calcul → M ; affichage ou événement → V ;
réaction à l'événement → C.
