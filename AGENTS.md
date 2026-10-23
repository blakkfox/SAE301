# AGENTS.md — SAE301 Honda Moto Click & Collect

## 1. Projet

Site responsive de click & collect pour Honda Moto Lyon Centre (SAÉ 3.01) : le
client commande accessoires, équipement, entretien et collection Honda, retire
en concession sous 2 h et paie sur place.

- Base technique : starter pédagogique (routeur, templates, PDO, session), domaine
  film entièrement remplacé par le domaine Honda.
- Une US = une branche `US-xxx`. L'avancement réel se lit dans `git log` et
  `git branch`.
- Recettes de code (page, composant, data, API) : `.agents/SKILL.md`.

## 2. Règles impératives

- **Ne code pas sans demande.** L'utilisateur demande des fonctions ou
  fonctionnalités précises : ne fais pas l'US entière à sa place.
- **Tout ce qui touche à Git et GitHub est fait par l'utilisateur** : commit,
  push, création ou changement de branche, merge, pull request, issues. Tu peux
  seulement lire (`git status`, `git log`, `git diff`, `git branch`). Pas de
  travail sur `main`.
- Ne déplace, ne renomme ni ne réorganise aucun fichier sans demande.
- Ne touche pas aux identifiants de `back/config/config.php`.
- Aucune dépendance npm ou Composer sans accord.
- Lis les fichiers concernés et leurs appelants avant de modifier.
- Deux architectures possibles, ou doute sur l'emplacement d'une fonction :
  arrête-toi et demande.
- **Jamais de `foreach` (PHP) ni de `.forEach()` (JS).**
- Code en anglais ; commentaires, messages et données métier en français. Les
  noms français du starter restent (`ErreurApi`, `$controleurs`, `Response::erreur`…).
- Documentation : JSDoc / PHPDoc sur chaque fonction, méthode et classe. Les
  autres commentaires expliquent seulement un choix non évident.

## 3. Maquettes Figma

Fichier `MXy6t4vmIh9lkBfjrPcKgj`, page « Maquettes — Desktop » (`50:2`) :
<https://www.figma.com/design/MXy6t4vmIh9lkBfjrPcKgj/Matthias_accini?node-id=50-2>

Utilise directement le MCP Figma connecté, avec ce `fileKey` et le `nodeId` de
l'écran :

- `get_screenshot` pour voir l'écran avant de coder son interface ;
- `get_design_context` pour les mesures et la structure (charge d'abord le
  skill `figma-design-to-code`) — c'est une référence à adapter aux tokens et
  composants du projet, pas du code à copier ;
- `get_variable_defs` pour les valeurs des tokens.

| N° | US | Écran | nodeId |
|---|---|---|---|
| 1 | DEC-b | Catalogue | `50:3` |
| 2 | DEC-c | Détail produit | `54:223` |
| 3 | DEC-a | Catégories | `57:356` |
| 4 | CMD-b | Panier | `55:309` |
| 5 | CMD-c | Authentification | `57:530` |
| 6 | CMD-a | Validation de commande | `57:623` |
| 7 | STK-b | Affichage des stocks | `58:584` |
| 8 | STK-c | Contraintes de stock | `58:784` |
| 9 | STK-a | Mise à jour auto des stocks | `58:894` |
| 10 | GOF-b | Back-office | `61:1334` |
| 11 | PIL-b | Gestion des commandes | `61:1478` |
| 12 | GOF-c | Gestion des catégories | `61:1673` |
| 13 | SUI-c | Historique des commandes | `59:907` |
| 14 | SUI-b | Espace personnel | `59:1053` |
| 15 | SUI-a | Commander à nouveau | `59:1163` |
| 16 | OPT-c | Choix des options | `60:979` |
| 17 | OPT-a | Options panier et commande | `60:1074` |
| 18 | OPT-b | Variantes | `60:1185` |
| 19 | GOF-a | Gestion des produits | `62:1249` |
| 20 | PIL-a | Statistiques | `62:1430` |
| 21 | PRO-c | Promotions automatiques | `62:1723` |
| 22 | PRO-b | Gestion des codes promo | `62:1582` |
| 23 | PRO-a | Utiliser un code promo | `60:1270` |

**Ordre de réalisation** : celui des numéros. Les lots sont : Vitrine (1-3),
Commande (4-6), Stocks (7-9), Admin de base (10-12), Espace client (13-15),
Options (16-18), Admin avancée (19-20), Bonus PRO (21-23, seulement si tout le
reste est propre). Ne commence pas un lot avant la fin du précédent sans
demande explicite ; chaque lot se termine par un site qui fonctionne.

## 4. Architecture

| Zone | Rôle | Emplacement |
|---|---|---|
| Front | SPA Vite + Tailwind CSS 4 : `layouts/`, `pages/`, `ui/`, `data/`, `lib/` | `front/src/` |
| Back | API JSON PHP : `Core/`, `Controller/`, `Model/`, `routes.php` | `back/src/`, entrée `back/index.php` |
| Données | Schéma et seeds | `sql/import.sql` |
| Entrée HTTP | `/api/...` vers PHP, le reste vers `front/dist/` | `.htaccess` |

Une route API se déclare dans `back/src/routes.php` et son contrôleur
s'instancie dans `$controleurs` de `back/index.php`. Pas de nouvelle couche ni
de framework.

## 5. MVC strict (pages et layouts)

| Objet | Rôle | Interdit |
|---|---|---|
| **M** | État, appels `data/`, calculs ; retourne des données prêtes à afficher | référencer V ou C, toucher au DOM ou à `window` |
| **V** | DOM uniquement : templates, rendu, écouteurs branchés sur `C.handler_…` | référencer M, logique métier |
| **C** | Passerelle : `C.init()` puis `C.handler_<action>` qui mettent à jour M et appellent V | DOM hors de `ev`, stocker des données |

- Un besoin se découpe ainsi : donnée ou calcul → M ; affichage ou écouteur → V ;
  réaction → C.
- La fonction de page exportée renvoie `C.init(params)` au routeur.
- Un composant `ui/` reçoit ses données et signale les actions par
  `actions.onX(...)` ; il n'importe jamais `data/`.
- Après une action, on reconstruit le bloc concerné à partir de l'état
  (`replaceKeepingFocus`), pas de retouches DOM dispersées.

## 6. Front

- ES modules, `async/await`. Tout appel réseau passe par `front/src/data/` et
  `lib/api-request.js` ; les erreurs sont gérées avec `ErreurApi.statut`.
- Toute valeur insérée dans un template passe par `genericRenderer` (échappement).
  Jamais d'`innerHTML` avec une donnée non échappée.
- Les liens internes portent `data-link` ; on garde le `base` Vite et la page 404.
- Les états chargement, vide, erreur, succès, non connecté et stock (« En stock »,
  « Bientôt épuisé », « Épuisé ») sont visibles et annoncés (`role="status"`).

## 7. Design et CSS

- Charte : fond blanc, texte gris anthracite, rouge Honda pour les actions et
  promotions, pied de page noir ; titres en Barlow Condensed, textes en Barlow ;
  admin avec menu latéral noir, zone grise et cartes blanches.
- Maquettes en 1440 px uniquement : mobile et tablette sont à déduire, en
  Mobile First. Rien ne casse entre 320 px et 1440 px.
- Images : `alt`, ratio fixe, `loading="lazy"` hors du premier écran, état
  « Photo à venir ».
- Tailwind v4 uniquement, tout dans `front/src/global.css` : tokens primitifs
  et sémantiques dans `@layer base`, exposés dans `@theme inline` (seulement les
  sémantiques) ; composants réutilisables dans `@layer components`, avec des
  variables privées (`--_bg`) que les modifiers réassignent.
- Pas de Sass ni de fichier `.css` supplémentaire. Classes Tailwind écrites en
  entier, jamais assemblées.

## 8. Back et sécurité

- `declare(strict_types=1)`, tout est typé, classes `final`, état `private`.
- Contrôleur : valide et orchestre. Modèle : SQL uniquement.
- Réponses JSON uniquement, via `Response::json()` / `Response::erreur()`, qui
  font `exit` : pose les cookies avant.
- Requêtes PDO préparées ; liste blanche serveur pour tout fragment SQL
  dynamique (`ORDER BY`, colonnes).
- Session : `session_start()` une seule fois dans `index.php`, après le
  réglage du cookie ; `session_regenerate_id(true)` après connexion.
- Aucun rôle, droit, prix ou statut de confiance côté client ou dans un cookie :
  le serveur revalide quantité, variante, option, stock, prix et statut.

**Règles métier**

- Référence, prix et stock portés par la variante ; photos dans `product_image` ; panier et lignes de commande
  identifiés par `variantId`, avec prix et suppléments figés à la commande.
- `CMD-a` valide la commande (concession, créneau, paiement sur place) et
  décrémente le stock dans **une transaction** : si un article manque, rien
  n'est enregistré.
- `STK-a` ajoute le journal des mouvements et la fonction de recrédit, appelée
  par `PIL-b` à l'annulation.
- Statuts : en cours → disponible → retirée, ou annulée. Une commande retirée ne
  s'annule plus.

## 9. Vérifier

Après chaque modification de code, depuis la racine du dépôt :

| Quoi | Commande |
|---|---|
| Découpage MVC et `foreach` | `node .agents/skills/verifier-mvc/scripts/check-mvc.js .` |
| Compilation du front | `cd front && npm run build` |
| Syntaxe PHP | `php -l <fichier>` |
| Rendu à 320, 768 et 1440 px | `cd front && npm run dev` → `http://localhost:5173/~accini1/SAE301-Starter/` |

Une erreur du script se corrige avant de rendre la main ; un avertissement se
justifie. L'API est celle de mmi.unilim.fr : un changement PHP n'est visible
qu'après déploiement. Ce qui n'a pas pu être vérifié est signalé.

## 10. Compte rendu

Après chaque modification, en sections numérotées :

1. fichiers créés, modifiés ou supprimés (chemins) ;
2. ce qui a changé et pourquoi, avec les lignes ;
3. vérifications faites et résultats ;
4. points d'attention, impacts et prochaine étape dans l'ordre des US.
