---
name: verifier-mvc
description: Vérifie le découpage MVC des pages du front et l'absence de foreach. À lancer après chaque modification de code.
---

# Vérifier le découpage MVC

```
node .agents/skills/verifier-mvc/scripts/check-mvc.js .
```

| Contrôle | Niveau |
|---|---|
| Chaque `front/src/pages/*/page.js` déclare M, V, C et `C.init` | erreur |
| M ne référence ni V ni C et ne touche pas au DOM | erreur |
| V ne référence pas M | erreur |
| C utilise M et V, et ne touche au DOM que via `ev` | erreur |
| La fonction exportée renvoie `C.init()` | erreur |
| Un composant `front/src/ui/*/index.js` n'importe pas `data/` | erreur |
| Aucun `foreach` (PHP) ni `.forEach()` (JS) | erreur |
| V ne branche aucun `C.handler_…` ; méthode de C ni `init` ni `handler_` | avertissement |

Les commentaires, chaînes et regex sont ignorés. Le script sort avec le code 1 s'il
y a au moins une erreur. Une erreur se corrige ; un avertissement se justifie dans
le compte rendu.
