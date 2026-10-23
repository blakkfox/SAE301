# SAE301-Starter

Click & collect Honda Moto Lyon Centre (SAÉ 3.01) : une API PHP en trois
couches (routage / contrôleur / modèle) au-dessus de MySQL, et un front en
JavaScript organisé en layouts, pages et composants, avec un routeur côté
client. Charte Honda (tokens Figma) en Tailwind CSS 4.

- catalogue paginé et trié (US DEC-b), tri mémorisé dans un cookie ;
- produits déclinés en variantes, qui portent référence, prix et stock ;
- jusqu'à 4 photos par produit (galerie de la fiche) ;
- connexion, création de compte et mot de passe oublié (US CMD-c), par
  session serveur ; comptes en base, mots de passe hachés.

## Arborescence

```
.htaccess            /api/... vers le back, tout le reste vers front/dist/
sql/import.sql       tables (category, product, variant, product_image, customer…) et jeu de données
back/                API PHP, ne renvoie que du JSON
├── index.php        point d'entrée : assemble les dépendances, délègue
├── config/          identifiants de la base, chemin du projet
└── src/             Core/ (Request, Response, Router, Database),
                     Controller/, Model/, routes.php
front/               sources du front (Vite + Tailwind)
├── index.html       page unique de l'application
├── vite.config.js   chemin du projet, proxy de développement
├── src/
│   ├── main.js      déclaration des routes et des layouts
│   ├── global.css   Tailwind, tokens de la charte Honda
│   ├── layouts/     structures de page (en-tête + slot de la page)
│   ├── pages/       une page par route : page.js + template.html
│   ├── ui/          composants réutilisables : index.js + template.html
│   ├── data/        appels à l'API, un module par ressource
│   └── lib/         routeur, rendu des templates, requêtes, utilitaires
└── dist/            résultat de npm run build (non versionné)
```

## Installation

1. Importez `sql/import.sql` dans votre base depuis phpMyAdmin (il crée toutes
   les tables et le jeu de données ; l'import est rejouable).
2. Dans `back/config/config.php`, renseignez les identifiants de la base et
   le chemin du projet (`/~votre_login/Base/`).
3. Dans `front/vite.config.js`, donnez à `BASE` **exactement** le même chemin.
4. Dans `front/`, installez les dépendances :

```bash
npm install
```

Le chemin du projet apparaît donc à deux endroits, et seulement là :
`config.php` pour le back (chemin des cookies), `vite.config.js` pour le front
(adresses des fichiers et des pages).

## Développer

```bash
npm run dev
```

Le front est servi par Vite à `http://localhost:5173/~votre_login/Base/`, avec
rechargement à chaque modification. Les requêtes `/~votre_login/Base/api/...`
sont relayées par Vite vers l'API déployée sur `mmi.unilim.fr` : le back doit
donc être en place sur le serveur (voir Déployer).

Ce relais (le proxy de `vite.config.js`) fait croire au navigateur que front
et API sont sur le même site, sous le même chemin qu'en production. Les
cookies posés par l'API (préférences, session) sont donc acceptés et renvoyés
normalement. Sans lui, le front sur `localhost` appellerait directement
`mmi.unilim.fr` : deux sites différents, et le navigateur refuserait d'envoyer
les cookies.

Utilisez Chrome ou Firefox : les cookies de l'API sont `Secure`, et Safari
peut les refuser sur `http://localhost`.

## Déployer

```bash
npm run build
```

Le front compilé est produit dans `front/dist/`. Déposez ensuite dans votre
espace web, dans le dossier `Base/` : `.htaccess`, `back/` et `front/dist/`
(en gardant ce chemin). Inutile de déposer `front/node_modules/`.

L'application est alors à `https://mmi.unilim.fr/~votre_login/Base/`. Le
`.htaccess` sert les fichiers de `front/dist/`, et répond par
`front/dist/index.html` à toute autre adresse (`/admin`…) : c'est le routeur
du front qui affiche la bonne page, ou la page 404.

## Architecture du front

### Routeur (`lib/router.js`)

Déclaré dans `main.js`, sur le modèle de `react-router` :

```js
router.addLayout("/", RootLayout);
router.addRoute("/", CataloguePage);
router.addRoute("/admin", AdminPage);
router.addRoute("/produits/:id", ProductPage);   // params.id dans la page
router.addRoute("*", The404Page);          // toujours en dernier
```

- Un lien interne porte `data-link` et un chemin de route, sans le chemin du
  projet : `<a href="/admin" data-link>`. Le routeur intercepte le clic,
  change l'adresse sans recharger, et complète lui-même le `href` avec le
  chemin du projet (comme `basename` dans `react-router`).
- Le lien de la page affichée reçoit `aria-current="page"`, que Tailwind
  cible avec `aria-[current=page]:…`.
- Une page renvoie une chaîne HTML (page statique) ou un fragment, ou une
  promesse de l'un des deux (page qui charge des données).
- Le layout est choisi par le plus long préfixe d'adresse. La page prend la
  place de son `<slot>` sans nom.

### Composants (`ui/`)

Un dossier par composant : le HTML et les classes Tailwind dans
`template.html`, le JavaScript dans `index.js`. Le composant expose
`html(data)` (chaîne) et/ou `dom(data, actions)` (fragment).

- `{{cle}}` dans un template est remplacé par la valeur correspondante,
  **échappée** : un placeholder ne produit jamais que du texte. Pour insérer
  un autre composant, on utilise un `<slot name="…">`, que le JavaScript
  remplace (`slot.replaceWith(Composant.dom(…))`).
- Un template n'a ni boucle ni condition : une liste se construit avec un
  template par élément (`ui/category-menu/item.html`), et un état
  (option choisie, bouton désactivé) se règle en JavaScript après
  `htmlToFragment`.
- Un composant ne décide de rien : il reçoit ses données, et signale les
  actions de l'utilisateur par les fonctions de `actions`
  (`surTri`, `surPage`…), comme les props `onChange` de React.
- Tailwind ne génère que les classes écrites en entier dans le code :
  `"text-red-700"`, jamais `"text-" + couleur`.

### Pages (`pages/`)

Une page dynamique suit le découpage Modèle / Contrôleur / Vue :

- `M` contient l'état de la page (réponse de l'API, message affiché…) ;
- `C` contient les traitements : chargement des données, réactions aux
  actions de l'utilisateur ;
- `V` construit la page à partir de `M`. Après chaque changement, toute la
  page est reconstruite et remplace l'ancienne (`V.rafraichir()`) :
  l'affichage se déduit de l'état, on ne le retouche pas morceau par morceau.

## L'API

| Route | Effet |
|---|---|
| `GET /api/products?page=2&sort=price_asc` | une page du catalogue (12 produits), triée au prix payé de la variante la moins chère ; `promotion` : le produit en promotion automatique (comme `GET /api/promotion`), ou `null` |
| `GET /api/products?q=casque` | recherche de l'en-tête : les produits dont le nom, la description ou la catégorie contient chacun des mots (5 au plus, 60 caractères), sans distinction de casse ni d'accents ; `q` : la recherche appliquée. Se combine avec `sort`, `inStock`, `page` |
| `GET /api/products?category=collection-honda` | une page des produits d'une catégorie, sous-catégories comprises. 404 si la catégorie n'existe pas |
| `GET /api/categories` | arbre des catégories visibles (une catégorie masquée, ou dont la parente est masquée, en est absente avec ses produits) (`children` : sous-catégories) avec leur nombre de produits (`productCount`), et `total` du catalogue |
| `GET /api/promotion` | promotion automatique (US PRO-c) : `promotion` (`id`, `name`, `price` remisé, `originalPrice`, `discountRate`), le produit visible au plus grand stock total (plus petit `id` en cas d'égalité) remisé de 20 % (`ProductModel::PROMO_RATE`), ou `null` si aucun produit n'a de stock. Recalculée à chaque requête. Les cartes produit, la fiche et les variantes du panier portent aussi `originalPrice` et `discountRate` (`null` hors promotion), `price` étant toujours le prix à payer |
| `GET /api/product?id=13` | fiche d'un produit : catégorie, photos (`images`, dans l'ordre de la galerie), variantes avec leur prix (`price`, `originalPrice`, `discountRate`), caractéristiques, options à cocher (`options` : `id`, `label`, `description`, supplément `price`, US OPT-c), et 4 suggestions (`related`). 400 si `id` invalide, 404 si produit introuvable |
| `GET /api/me` | compte connecté (`customer`), ou `null` |
| `POST /api/login` | connexion, corps JSON `{"email": …, "password": …}`. 401 si identifiants incorrects, 429 après 5 échecs en 15 minutes pour cette adresse depuis la même IP (ou 20 depuis l'IP) |
| `POST /api/register` | création de compte puis connexion, corps JSON `{firstName, lastName, email, phone, password, passwordConfirm}`. 422 si saisie invalide, 409 si e-mail déjà pris (erreurs par champ dans `champs`) |
| `POST /api/password-reset` | nouveau mot de passe d'un compte client, corps JSON `{email, phone, password, passwordConfirm}`. Version simplifiée (sans e-mail) : le téléphone du compte sert de vérification ; les comptes admin sont exclus. 404 si l'adresse et le numéro ne correspondent à aucun compte client (même message dans tous les cas), 429 comme la connexion |
| `POST /api/logout` | déconnexion |
| `GET /api/cart?variants=12,4` | variantes du panier : nom, photo, prix (remisé pour le produit en promotion, US PRO-c), stock et options proposées pour leur produit (`options`, US OPT-a). Une variante absente de la réponse n'est plus au catalogue |
| `GET /api/promo-code?code=bienvenue10` | code promo saisi au panier (US PRO-a), mis en majuscules : `promoCode` (`code`, `discountRate` en %, `minAmount` en euros, 0 : sans minimum) s'il est actif aujourd'hui. La remise porte sur toute la commande (produits, déjà remisés pour la promotion automatique, et options), arrondie au centime, dès `minAmount`. 404 si le code n'existe pas, 422 s'il est vide, programmé, expiré ou épuisé (message à afficher dans `champs.promoCode`) |
| `POST /api/orders` | validation de la commande (US CMD-a), corps JSON `{dealershipId, slot, items: [{variantId, quantity, optionIds}], promoCode}` (`optionIds` facultatif, US OPT-a ; `promoCode` facultatif, US PRO-a). Prix et suppléments relus en base et figés (`order_line`, `order_line_option`) ; le produit en promotion (US PRO-c, lu avant la baisse du stock) est figé à son prix remisé, sans remise sur les suppléments. Le code promo est revérifié, sa remise figée (`promo_code`, `discount`, réponse `promoCode` / `discount`) et déduite de `total`, et son utilisation comptée (`use_count`) dans la même transaction. 401 sans session, 400 si articles invalides, 422 si concession, créneau, option ou code promo refusé (code inconnu, pas actif, montant minimum non atteint ou dernière utilisation prise entre-temps), 409 si stock insuffisant : rien n'est alors enregistré |
| `GET /api/orders?period=6` | historique du compte connecté (US SUI-c) : ses commandes (`orders`) des plus récentes aux plus anciennes, avec lignes (et leurs `options`), code promo et remise (`promoCode`, `discount`), concession et journal des statuts (`events`, sans l'administrateur). Périodes : `3`, `6` (défaut), `12` derniers mois ou `all`. 401 sans session |
| `GET /api/order?id=97` | une commande du compte connecté (US SUI-a), pour la commander à nouveau : `order` (lignes au prix payé, concession, `events`, `dayOffset`). Le stock actuel se lit avec `GET /api/cart`. 401 sans session, 400 si `id` invalide, 404 si la commande n'existe pas ou est celle d'un autre compte |
| `GET /api/account` | espace personnel du compte connecté (US SUI-b) : `customer` (prénom, nom, e-mail, téléphone, `preferredDealershipId`), `dealerships`, `lastOrder` (commande la plus récente avec `dayOffset`, ou `null`). 401 sans session |
| `POST /api/account` | modification des informations, corps JSON `{firstName, lastName, email, phone, preferredDealershipId}` (`null` : aucune préférence). Répond `customer`. 422 si saisie invalide, 409 si l'e-mail est celui d'un autre compte |
| `POST /api/account/password` | changement de mot de passe, corps JSON `{currentPassword, password, passwordConfirm}`. 422 si le mot de passe actuel est faux ou le nouveau invalide |
| `POST /api/admin/login` | connexion du back-office (US GOF-b), corps JSON `{"email": …, "password": …}`. 401 si identifiants incorrects **ou compte client**, 429 comme la connexion |
| `GET /api/admin/dashboard` | tableau de bord : indicateurs (`stats`), prochaines commandes (`upcomingOrders`), alertes stock (`stockAlerts`, `stockAlertCount` : variantes au plus au seuil « Bientôt épuisé » de leur produit, US GOF-a). 401 sans session, 403 pour un compte client |
| `GET /api/admin/orders?status=en_cours&q=dupont&sort=total_desc&page=2` | gestion des commandes (US PIL-b) : une page de 20 commandes (`orders`), nombre par statut (`counts`, avec `all`) selon la recherche, réglages appliqués. Tris : `pickup_desc` (défaut), `pickup_asc`, `customer_asc`, `customer_desc`, `total_desc`, `total_asc`, `status_asc`, `status_desc`. 401, 403 comme le tableau de bord |
| `GET /api/admin/order?id=142` | détail d'une commande : lignes (avec leurs `options`, US OPT-a), client, concession, journal des statuts (`events`). 400 si `id` invalide, 404 si introuvable |
| `POST /api/admin/orders/status` | corps JSON `{"ids": [142, 141], "status": "disponible" \| "retiree"}` : passage en lot, seulement depuis le statut précédent du cycle. Répond `updated` et `skipped` |
| `POST /api/admin/orders/cancel` | corps JSON `{"id": 142}` : annulation et recrédit du stock (STK-a), dans une transaction. 409 si la commande est retirée ou déjà annulée |
| `GET /api/admin/categories` | gestion des catégories (US GOF-c) : toutes les catégories, masquées comprises, en arbre, avec `isVisible` et `productCount` (tous les produits, sous-catégories comprises). 401, 403 comme le tableau de bord |
| `POST /api/admin/categories` | création, corps JSON `{name, description, isVisible, parentId}` (slug calculé depuis le nom). 422 si saisie invalide, 409 si le nom est déjà pris (erreurs par champ dans `champs`) |
| `POST /api/admin/categories/update` | modification, même corps avec `id` (le slug ne change pas). Une catégorie qui a des sous-catégories reste au premier niveau. 404 si introuvable |
| `POST /api/admin/categories/delete` | suppression, corps JSON `{"id": 15}`. 409 si la catégorie contient encore des produits ou des sous-catégories |
| `GET /api/admin/products` | gestion des produits (US GOF-a) : tous les produits, en ligne ou non (`isActive`), avec catégorie, nombre de variantes, stock total, prix de la variante la moins chère et de la plus chère (`price`, `maxPrice`), stock de la variante la plus basse (`minStock`) et seuil « Bientôt épuisé » (`lowStockThreshold`). 401, 403 comme le tableau de bord |
| `GET /api/admin/product?id=13` | fiche d'un produit : informations, `images` (photos choisies, dans l'ordre), `variants` (avec leur `price`), `options`, 8 derniers mouvements de stock (`movements`), et pour le formulaire `categories` (masquées comprises) et `images` (fichiers de `front/dist/images/produits/`). Sans `id` : `product` vaut `null` (nouveau produit). 400, 404 |
| `POST /api/admin/products` | création, corps JSON `{name, description, categoryId, images: ["photo.jpg"…], variantAxis, lowStockThreshold, isActive, variants: [{id: null, label, reference, price, stock}], options: [{id: null, label, description, price}]}` (au plus 4 photos, la première est celle des cartes) (slug calculé depuis le nom). Le stock initial est journalisé (`reassort`). 422 si saisie invalide (erreurs par champ, `variants.0.reference`…), 409 si une référence est déjà prise |
| `POST /api/admin/products/update` | enregistrement, même corps avec `id` ; chaque variante existante envoie son `id` et `previousStock` (stock affiché au chargement) : seul l'écart est appliqué et journalisé (`reassort` ou `ajustement`). Variantes et options absentes du corps supprimées, sauf une variante présente dans une commande en cours ou disponible (422). 404 si introuvable |
| `POST /api/admin/products/delete` | suppression, corps JSON `{"id": 13}` (variantes, photos, options et journal avec). 409 si le produit est dans une commande en cours ou disponible |
| `GET /api/admin/promo-codes` | gestion des codes promo (US PRO-b) : tous les codes (`promoCodes`), du plus récent au plus ancien : `code`, `discountRate` (%), `minAmount` (montant minimum du panier, 0 : sans minimum), `startsOn` / `endsOn` (« 2026-12-31 », `null` : sans borne, jours compris), `maxUses` (`null` : illimité), `useCount`, et `status` calculé à la date du jour : `actif`, `programme` (début à venir), `expire` (fin passée) ou `epuise` (`useCount` a atteint `maxUses`). 401, 403 comme le tableau de bord |
| `POST /api/admin/promo-codes` | création, corps JSON `{code, discountRate, minAmount, startsOn, endsOn, maxUses}` (valeurs telles que saisies : `"50,00"`, `""` pour sans minimum, sans date ou illimité). Le code est mis en majuscules : 3 à 20 lettres sans accent et chiffres ; réduction entière de 1 à 90 % ; fin au plus tôt le jour du début, et pas déjà passée. 422 si saisie invalide, 409 si le code existe déjà (erreurs par champ dans `champs`) |
| `POST /api/admin/promo-codes/update` | modification, même corps avec `id` ; `useCount` ne change pas et `maxUses` ne peut pas lui être inférieur (422). Une fin déjà passée reste acceptée si elle n'a pas été modifiée. 404 si introuvable |
| `POST /api/admin/promo-codes/delete` | suppression, corps JSON `{"id": 4}`. Répond `deleted` (`id`, `code`). 404 si introuvable |
| `GET /api/admin/stats?period=30` | statistiques (US PIL-a), périodes `7`, `30` (défaut) ou `year` (année en cours) : `stats` (revenus `revenue` et commandes `orderCount` de la période, avec `previousRevenue` / `previousOrderCount` de la période précédente de même durée ; `inProgressCount`, `availableCount`, `cancelledCount` depuis l'ouverture), `dailyRevenue` (7 derniers jours, `isClosed` le dimanche), `bestSellers` (5 produits les plus vendus), `stock` (produits en ligne, stock total et seuil), `stockAlerts` / `stockAlertCount` comme le tableau de bord. Revenus : commandes **retirées**, comptées le jour du retrait (paiement sur place) ; commandes : passées sur la période, annulées exclues. 401, 403 comme le tableau de bord |

Tris acceptés : `price_asc` (défaut), `price_desc`, `name_asc`, `newest`.
`sort` est facultatif : sans lui, le serveur applique le tri mémorisé dans le
cookie `sort`. La réponse rappelle les réglages appliqués (`sort`, `page`,
`pageCount`, `perPage`, `total`) avec la liste `products`
(`id`, `name`, `price` de la variante la moins chère, `priceFrom` vrai si les
variantes n'ont pas toutes ce prix, `image` : la première photo) : le front n'a jamais besoin de lire le
cookie, qui est en `HttpOnly`. Les photos sont dans
`front/public/images/produits/`.

## Comptes

| E-mail | Mot de passe | Rôle |
|---|---|---|
| `alice@exemple.fr` | `azerty` | `customer` |
| `admin@honda-lyon.fr` | `motdepasse` | `admin` |

## Si ça ne marche pas

| Symptôme | Cause probable |
|---|---|
| Un listing de dossiers, ou une erreur 404 sur la racine | le `.htaccess` n'a pas été déposé, ou `front/dist/` est absent (lancer `npm run build`) |
| Page blanche, fichiers `assets/…` en 404 | `BASE` de `vite.config.js` ne correspond pas au dossier de dépôt |
| « Impossible de charger le catalogue » | identifiants de `config.php`, ou `sql/import.sql` non importé |
| `Unknown column … low_stock_threshold` (ou `variant_axis`) | base antérieure à GOF-a (ou OPT-b) : réimporter `sql/import.sql` |
| `Table … promo_code doesn't exist` | base antérieure à PRO-b : réimporter `sql/import.sql` |
| `Unknown column … promo_code` (ou `discount`) dans `customer_order` | base antérieure à PRO-a : réimporter `sql/import.sql` |
| Les réglages ne sont jamais retenus, la connexion ne tient pas | `chemin` de `config.php` ne correspond pas au dossier de dépôt |
| En développement, l'API répond 404 | le back n'est pas déployé sur le serveur, ou `BASE` est faux |
