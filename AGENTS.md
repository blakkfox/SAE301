# AGENTS.md — SAE301 Honda Moto Click & Collect

## 0. Mission du projet

Ce dépôt est le projet SAÉ 3.01 : un site web responsive de click & collect
pour Honda Moto Lyon Centre. Le client commande en ligne des accessoires, de
l'équipement, des produits d'entretien et des articles de la collection Honda,
puis les retire en concession sous 2 h et paie sur place.

Le code actuel est le starter pédagogique `SAE301-Starter` (catalogue de
films) : il sert de base technique (routeur, templates, requêtes API, routeur
PHP, PDO, session), mais tout le domaine film est à remplacer par le domaine
Honda (produits, variantes, options, stock, commandes, concessions).

Les maquettes de référence sont sur
[Figma](https://www.figma.com/design/MXy6t4vmIh9lkBfjrPcKgj/Matthias_accini?node-id=50-2) :
un écran desktop par US, numérotés de 1 à 23 dans l'ordre de réalisation.
Ouvre l'écran de l'US avant de coder son interface.

Le résultat attendu doit fonctionner sur mobile, tablette et desktop. Il doit
conserver les principes de navigation, d'accessibilité, de sécurité et de
séparation front/back du starter, tout en remplaçant progressivement le
domaine film par le domaine Honda.

Ne réorganise, ne renomme et ne déplace jamais un fichier existant sans demande
explicite. Respecte l'architecture présente avant de proposer une évolution.
Parcours l'intégralité du dépôt, y compris `front/`, `back/`, `sql/`, les
configurations et les sous-dossiers, avant une modification structurante.

## 1. Règles d'exécution impératives

- Ne committe et ne pousse jamais automatiquement. Le commit, le push et toute
  action Git distante ne sont effectués que si l'utilisateur le demande
  explicitement. Le travail se fait sur une branche par US, jamais sur `main`.
- Ne crée pas de dépendance, bibliothèque ou outil de build supplémentaire sans
  justification et accord lorsque l'impact est significatif.
- Ne modifie pas des secrets ou identifiants réels (`back/config/config.php`).
  Les valeurs sensibles restent dans la configuration locale et ne doivent
  jamais être ajoutées au dépôt.
- Avant une modification importante, lis les fichiers concernés et leurs
  appelants. Après modification, valide le comportement avec les commandes
  adaptées.
- Si deux architectures sont raisonnables et que le choix change fortement le
  code, arrête-toi et demande une décision.
- Les commentaires expliquent uniquement l'intention d'un choix non évident.
  Toute fonction, méthode ou classe publique doit être documentée en JSDoc ou
  PHPDoc.
- JAMAIS DE foreach (ni `foreach` en PHP, ni `.forEach()` en JS).
- Les noms de méthodes et variables sont en anglais dans le code ; les données
  métier et commentaires pédagogiques peuvent rester en français comme dans
  l'existant. Ne renomme pas le code français du starter sans demande.
- Pour chaque test que tu veux faire ou chose que tu veux vérifier : `cd front/`
  puis `npm run dev` puis ouverture du lien
  `http://localhost:5173/~accini1/SAE301-Starter/` (valeur de `BASE` dans
  `vite.config.js`). Les appels `/api/...` sont relayés vers mmi.unilim.fr :
  le back doit y être déployé pour répondre.

## 2. Architecture actuelle à respecter

Le dépôt est un full-stack sans framework applicatif :

| Zone        | Rôle                                                                     | Emplacement          |
| ----------- | ------------------------------------------------------------------------ | -------------------- |
| Front       | SPA Vite, Tailwind CSS 4, routeur client, pages et composants            | `front/`             |
| Back        | API JSON PHP, routage, contrôleurs et accès PDO/MySQL                    | `back/`              |
| Données     | Schéma et seeds SQL, à remplacer par produits/variantes/stock/commandes | `sql/import.sql`     |
| Entrée HTTP | Réécriture `/api/...` vers PHP et du reste vers `front/dist/`            | `.htaccess` (racine) |

Le front conserve le découpage `layouts/`, `pages/`, `ui/`, `data/` et `lib/`.
Le back conserve `Core/`, `Controller/`, `Model/`, `routes.php` et son point
d'entrée `back/index.php`. Une nouvelle route se déclare dans `routes.php` et
son contrôleur s'enregistre dans `$controleurs` de `back/index.php`. Ne crée
pas une nouvelle couche ou un nouveau framework seulement pour contourner
cette structure.

Voir `README.md`.

## 3. MVC strict

Pour chaque page dynamique, respecter strictement :

- **M — Modèle** : état de la page, données reçues, appels et transformations
  métier. Il ne référence jamais la Vue et ne touche jamais au DOM.
- **V — Vue** : templates, rendu, accès DOM et déclaration des événements. Elle
  reçoit les données en paramètre et ne référence jamais le Modèle.
- **C — Contrôleur** : orchestre M et V, charge les données, valide les actions
  et contient les handlers. C est le seul objet qui référence M et V.

En JavaScript vanilla, `C.init()` est appelé après toutes les déclarations
comme point d'entrée de la page. Dans le front modulaire actuel, la fonction de
page peut retourner `C.init()` au routeur, mais la séparation M/C/V reste
obligatoire.

Lorsqu'une fonctionnalité est ajoutée, la découper ainsi :

1. donnée, règle ou calcul → M ;
2. affichage, template ou écouteur → V ;
3. réaction à l'action → C.

Un composant UI ne décide pas de la donnée à afficher : il reçoit ses données
et signale l'action via des callbacks. Une page est reconstruite depuis son
état après une mutation importante ; évite les modifications DOM dispersées.

Attention : les pages du starter (`catalogue`, `admin`) ont une Vue qui lit
`M` directement et un `window.scrollTo` dans C. Ne reproduis pas ces écarts.

**Toute modification ou ajout respecte strictement ce découpage.** En cas de doute
sur l'emplacement d'une fonction, s'arrêter et demander plutôt que de mélanger les rôles.

```
data (M) ----get----
                    |
                 C (Contrôleur) ------> page web
                    |
template (V) --get--
```

### M — le Modèle : les données et leur manipulation

- Contient les données de la page (`M.products`) et les fonctions qui les lisent,
  filtrent ou transforment (`M.filterProductsByCategory(categoryId)`).
- Ses fonctions reçoivent des valeurs simples en paramètre et **retournent des données**
  (tableaux, objets), jamais du HTML.
- **Interdit :** toute référence à `V`, tout accès au DOM (`document`, `window`, éléments HTML,
  événements).
- Autorisé : appeler `C` si besoin.

### V — la Vue : la page web

- Seul endroit où l'on touche au DOM : `htmlToFragment`, `querySelector`, `replaceWith`,
  `addEventListener`.
- `V.formatOne...(valeur)` remplit un template (`{{nom}}` → valeur) et retourne une chaîne.
- `V.render...(data)` reçoit les données **en paramètre** et les affiche ; elle ne décide
  pas quelles données afficher.
- `V.init()` enregistre les événements à surveiller et leur associe un gestionnaire de `C`.
- **Interdit :** toute référence à `M`, toute logique métier (filtrer, trier, calculer sur les
  données), tout gestionnaire d'événement qui ne soit pas une méthode de `C`.

### C — le Contrôleur : le lien entre M et V

- `C.init()` lance la page : initialise la Vue (et le Modèle s'il en a besoin), puis fait
  le premier affichage. La fonction de page exportée renvoie `C.init()` au routeur.
- `C.handler_<action>(ev)` gère un événement : lit l'information utile dans `ev`
  (ex. `ev.target.dataset.variant`) ou la valeur transmise par le composant, interroge ou
  met à jour `M`, puis appelle `V` pour rafraîchir l'affichage.
- C est le seul objet autorisé à référencer à la fois `M` et `V`.
- **Interdit :** accéder au DOM autrement que par l'objet `ev` reçu ; stocker les données de
  l'application (elles vont dans `M`).

### Conventions à suivre

- Une fonction par propriété : `M.xxx = function(...) { ... }`, précédée d'un commentaire
  qui donne ses paramètres (`. paramètre ...`) et sa valeur de retour (`> valeur de retour ...`),
  comme dans le code existant.
- Noms : `M.filter...`, `V.formatOne...`, `V.render...`, `V.init`, `C.init`, `C.handler_clickOn...`.
- Un nouveau besoin se découpe toujours ainsi : donnée ou calcul → M ; affichage ou
  événement → V ; réaction à l'événement → C.

## 4. Front-end JavaScript

- Utilise ES modules et les conventions déjà présentes dans `front/src/`.
- Privilégie la délégation d'événements sur un ancêtre commun lorsque des
  éléments sont recréés dynamiquement.
- Toutes les données injectées dans un placeholder doivent être échappées
  (`genericRenderer` le fait). N'utilise `innerHTML` brut que via les helpers
  existants et jamais avec une valeur utilisateur non échappée.
- Les appels réseau passent par `front/src/data/` et
  `front/src/lib/api-request.js`, avec `async/await`, gestion explicite des
  erreurs et des statuts HTTP (`ErreurApi.statut`).
- Le routeur doit conserver les liens `data-link`, le `basename` Vite et la
  page 404.
- Les états loading, vide, erreur, succès, authentification et indisponibilité
  du stock (« En stock », « Bientôt épuisé », « Épuisé ») doivent être visibles
  et accessibles.

## 5. Design responsive et direction artistique

Le site reprend les maquettes Figma Honda :

- fond blanc, textes gris anthracite, rouge Honda pour les actions, l'accent
  et les promotions, pied de page noir ;
- titres en Barlow Condensed Bold, textes en Barlow ;
- en-tête : logo HONDA, Catalogue, Catégories, Promotions, recherche, Mon
  compte, Panier (n) ;
- cartes produit nettes : image, badge de stock, nom, prix (promo en rouge et
  ancien prix barré), bouton rouge « Ajouter au panier » ;
- administration : menu latéral noir, zone principale grise, cartes blanches ;
- contrastes conformes à l'accessibilité, animations discrètes et utiles ;
- grilles et composants Mobile First : une colonne mobile, composition
  intermédiaire tablette, grille des maquettes en desktop ;
- aucune largeur, image ou interaction ne doit casser entre 320 px et desktop ;
- les images doivent prévoir `alt`, ratio, lazy-loading lorsque pertinent et
  état de chargement.

Les maquettes sont en desktop 1440 px uniquement : les vues mobile et tablette
sont à déduire. Le responsive est une contrainte fonctionnelle, pas une
finition. Vérifie au minimum les vues à 320/375 px, 768 px et 1440 px lorsque
l'UI est modifiée. Utilise Tailwind en Mobile First et garde les classes
écrites en entier pour que le compilateur les détecte.

### CSS, Tailwind et Sass

- Le projet actuel utilise Tailwind CSS 4 via `@tailwindcss/vite`, dans
  `front/src/global.css`.
- Configure les tokens dans `@theme inline`, en séparant tokens primitifs et
  tokens sémantiques. Les valeurs viennent des variables Figma.
- Utilise des variables CSS privées de composant (`--_bg`, `--_fg`, etc.) ;
  les modifiers ne font que réassigner les variables.
- Ne pas introduire Sass ou CSS basique, on reste sur Tailwind v4.
- Architecture Tailwind v4 à respecter (c'est un exemple) :

```css
@import "tailwindcss";

@theme inline {
  --font-sans: "Barlow", sans-serif;
  --font-display: "Barlow Condensed", sans-serif;
  --color-action: var(--clr-action);
  --color-ink: var(--clr-text);
}

@layer base {
  :root {
    /* Tokens primitifs (couleurs de base, variables Figma) */
    --clr-honda-red: #cc0000;
    --clr-grey-800: #333333;
    --clr-white: #ffffff;

    /* Tokens sémantiques (ils disent à quoi ils vont servir) */
    --clr-action: var(--clr-honda-red);
    --clr-text: var(--clr-grey-800);
  }
}

@layer components {
  .button {
    --_bg: var(--color-action);
    --_fg: var(--clr-white);
    background-color: var(--_bg);
    color: var(--_fg);
  }

  .button--outline {
    --_bg: var(--clr-white);
    --_fg: var(--color-ink);
  }
}
```

## 6. Back-end PHP

- `declare(strict_types=1)` dans chaque fichier PHP.
- Conserve `back/index.php` comme point d'entrée unique : autoload,
  configuration, connexion, session, contrôleurs et routeur.
- Les contrôleurs valident la requête et orchestrent ; les modèles interrogent
  la base ; `Core/` contient les abstractions HTTP, DB et routage.
- Type toutes les propriétés, paramètres et valeurs de retour.
- Encapsule l'état avec `private`/`protected`, getters/setters validants et
  fluent setters uniquement lorsqu'ils correspondent au besoin.
- Préfère abstraction et polymorphisme pour les comportements réellement
  partagés.
- N'utilise jamais `foreach` ; utilise `for`, `while`, `array_map` ou un autre
  itérateur explicite.
- Ne renvoie jamais de HTML depuis l'API : les réponses restent JSON via
  `Response::json()` ou `Response::erreur()`. Ces méthodes font `exit` : pose
  les cookies avant.

## 7. Données, commandes et sécurité

Le modèle métier doit préserver les décisions documentées dans
`analyse-user-stories.md` et visibles dans les maquettes :

- une variante par produit au minimum (taille, garniture…), avec référence et
  stock portés par la variante ;
- panier et lignes de commande identifiés par `variantId`, avec options
  choisies, prix unitaire et suppléments figés ;
- validation de commande (concession et créneau de retrait, paiement sur
  place) dans une transaction SQL dès la première version ;
- décrément et journal du stock à la validation, recrédit lors de l'annulation
  (fonction écrite dans STK-a, appelée par PIL-b) ;
- statuts de commande : en cours → disponible → retirée, ou annulée ; une
  commande retirée ne peut plus être annulée ;
- authentification par session serveur et rôle non fiable côté client ;
- seeds disponibles dès le début pour débloquer les écrans de lecture.

Règles obligatoires :

- requêtes PDO préparées pour les valeurs ;
- liste blanche serveur pour tout identifiant SQL dynamique (`ORDER BY`,
  colonnes, filtres structurants) ;
- `session_start()` une seule fois, après configuration du cookie (`Path`,
  `HttpOnly`, `Secure`, `SameSite`) et avant toute sortie ;
- `session_regenerate_id(true)` après connexion réussie ou élévation de
  privilège ;
- aucun rôle, droit, prix ou état de commande de confiance dans un cookie ;
- réponses JSON centralisées avec code HTTP explicite et terminaison via `exit` ;
- validation serveur de toute quantité, variante, option, disponibilité, prix
  et état de commande ; le front ne fait jamais foi ;
- les écritures de commande et de stock sont atomiques, idempotentes lorsque
  nécessaire et protégées contre la survente : si un article n'est plus
  disponible, rien n'est enregistré.

## 8. Ordre de réalisation métier

Respecte l'ordre de `analyse-user-stories.md` (numéros des écrans Figma) sauf
décision explicite :

0. Préparation : base avec variantes, seeds, layout et tokens ;
1. Vitrine : `DEC-b` catalogue, `DEC-c` détail produit, `DEC-a` catégories ;
2. Commande : `CMD-b` panier, `CMD-c` authentification, `CMD-a` validation ;
3. Stocks : `STK-b` affichage, `STK-c` contraintes, `STK-a` mise à jour auto ;
4. Admin de base : `GOF-b` back-office, `PIL-b` gestion des commandes,
   `GOF-c` gestion des catégories ;
5. Espace client : `SUI-c` historique, `SUI-b` espace perso, `SUI-a`
   commander à nouveau ;
6. Options : `OPT-c` choix des options, `OPT-a` options panier/commande,
   `OPT-b` variantes ;
7. Admin avancée : `GOF-a` gestion des produits, `PIL-a` statistiques ;
8. Bonus : `PRO-c`, `PRO-b`, `PRO-a`, uniquement si tout le reste est propre.

Ne commence pas une US si ses dépendances du tableau source ne sont pas
terminées, sauf demande explicite. Chaque lot se termine par un site qui
fonctionne. Pour chaque US, conserve la traçabilité entre écran Figma,
interface, API, modèle SQL, critères d'acceptation et validation. Ne code pas
sans mon accord et mes demandes. Je te demande de coder des fonctions ou
fonctionnalités par-ci par-là, pas de tout faire à ma place.

## 9. Vérification obligatoire

Toujours à la fin de chaque requête, vérifier le découpage : `node .agents/skills/verifier-mvc/scripts/check-mvc.js .`
(si le script n'est pas dans le dépôt : vérifier à la main que V ne lit pas M,
que M et C ne touchent pas au DOM, et qu'il n'y a aucun `foreach`).

## 10. Documentation et compte rendu

Toute documentation générée doit être pédagogique : sections numérotées,
tableaux récapitulatifs, check-lists et diagnostic.

## 11. Après chaque modification

Fournis un résumé clair et expliqué avec :

1. la liste des fichiers modifiés, créés ou supprimés avec leur chemin d'accès
2. le détail des modifications apportées avec les lignes
3. les éventuels points d'attention et/ou étapes suivantes recommandées en respectant toujours l'ordre qui doit être suivi
4. les éventuels impacts sur le reste de l'application