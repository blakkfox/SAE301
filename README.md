# SAE301-Starter

Click & collect Honda Moto Lyon Centre (SAÉ 3.01) : une API PHP en trois
couches (routage / contrôleur / modèle) au-dessus de MySQL, et un front en
JavaScript organisé en layouts, pages et composants, avec un routeur côté
client. Charte Honda (tokens Figma) en Tailwind CSS 4.

- catalogue paginé et trié (US DEC-b), tri mémorisé dans un cookie ;
- produits déclinés en variantes, qui portent référence et stock ;
- connexion par session (à brancher sur l'interface avec CMD-c).

## Arborescence

```
.htaccess            /api/... vers le back, tout le reste vers front/dist/
sql/import.sql       tables category, product, variant et jeu de données
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
│   ├── global.css   Tailwind, thème sombre
│   ├── layouts/     structures de page (en-tête + slot de la page)
│   ├── pages/       une page par route : page.js + template.html
│   ├── ui/          composants réutilisables : index.js + template.html
│   ├── data/        appels à l'API, un module par ressource
│   └── lib/         routeur, rendu des templates, requêtes, utilitaires
└── dist/            résultat de npm run build (non versionné)
```

## Installation

1. Importez `sql/import.sql` dans votre base depuis phpMyAdmin (il crée les
   tables `category`, `product` et `variant`, et supprime les anciennes
   tables `film` et `genre` du starter).
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
router.addRoute("/films/:id", FilmPage);   // params.id dans la page
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
  template par élément (`ui/statistiques/ligne-genre.html`), et un état
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
| `GET /api/products?page=2&sort=price_asc` | une page du catalogue (12 produits) |
| `POST /api/login` | connexion, corps JSON `{"login": …, "mdp": …}` |
| `POST /api/logout` | déconnexion |

Tris acceptés : `price_asc` (défaut), `price_desc`, `name_asc`, `newest`.
`sort` est facultatif : sans lui, le serveur applique le tri mémorisé dans le
cookie `sort`. La réponse rappelle les réglages appliqués (`sort`, `page`,
`pageCount`, `perPage`, `total`) avec la liste `products`
(`id`, `name`, `price`, `image`) : le front n'a jamais besoin de lire le
cookie, qui est en `HttpOnly`. Les photos sont dans
`front/public/images/produits/`.

## Comptes

| Login | Mot de passe | Rôle |
|---|---|---|
| `alice` | `azerty` | `user` |
| `admin` | `motdepasse` | `admin` |

## Si ça ne marche pas

| Symptôme | Cause probable |
|---|---|
| Un listing de dossiers, ou une erreur 404 sur la racine | le `.htaccess` n'a pas été déposé, ou `front/dist/` est absent (lancer `npm run build`) |
| Page blanche, fichiers `assets/…` en 404 | `BASE` de `vite.config.js` ne correspond pas au dossier de dépôt |
| « Impossible de charger le catalogue » | identifiants de `config.php`, ou `sql/import.sql` non importé |
| Les réglages ne sont jamais retenus, la connexion ne tient pas | `chemin` de `config.php` ne correspond pas au dossier de dépôt |
| En développement, l'API répond 404 | le back n'est pas déployé sur le serveur, ou `BASE` est faux |
