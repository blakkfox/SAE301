---
trigger: always_on
description: Recettes de code du projet SAE301 Honda Moto — page MVC, template, composant UI, module data, route API PHP. Les règles sont dans AGENTS.md.
---

# Recettes de code SAE301

Avant d'écrire, ouvre le fichier modèle et recopie sa structure.

| Je dois… | Modèle à suivre |
|---|---|
| ajouter une page | `front/src/pages/cart/page.js`, puis `router.addRoute` dans `front/src/main.js` |
| ajouter un composant | `front/src/ui/quantity-stepper/` |
| appeler l'API | `front/src/data/product.js` |
| ajouter une route API | `back/src/Controller/CartController.php`, `back/src/Model/ProductModel.php` |
| ajouter un token ou un composant CSS | `front/src/global.css` (`.button`, `.field`) |

## 1. Page

Ordre : imports → JSDoc (US, écran Figma, route) → constantes → `M` → `C` → `V` → export.
Chaque objet est annoncé par un bandeau `// --- M — Modèle ---`.

```js
let M = {
  items: [], // un commentaire par champ d'état
  error: null,
};

/** Remet la page dans son état initial. */
M.reset = function () { … };

/** @param {string} id @returns {Promise<void>} */
M.load = async function (id) { … }; // try/catch : l'erreur va dans M.error

/** @returns {Object} Tout ce que V affiche, déjà formaté (formatPrice, libellés). */
M.getViewData = function () { … };

let C = {};

/** @returns {Promise<DocumentFragment>} */
C.init = async function (params) {
  M.reset();
  await M.load(params.id);
  return V.init(M.getViewData());
};

/** @param {number} quantity - Valeur transmise par le composant. */
C.handler_changeQuantity = function (quantity) {
  M.setQuantity(quantity);
  V.renderPurchase(M.getPurchaseData());
};

let V = {
  purchase: null, // bloc affiché, à remplacer ensuite
};

/** @param {Object} data @returns {DocumentFragment} */
V.init = function (data) { … }; // construit et RETOURNE la page (ou error.html)

/** @param {Object} purchaseData */
V.renderPurchase = function (purchaseData) {
  V.purchase = replaceKeepingFocus(V.purchase, V.createPurchaseFragment(purchaseData));
};

/** @param {Object} purchaseData @returns {DocumentFragment} */
V.createPurchaseFragment = function (purchaseData) {
  let fragment = htmlToFragment(genericRenderer(templatePurchase, purchaseData));
  fragment.querySelector('slot[name="quantity"]')
    .replaceWith(QuantityStepperView.dom(purchaseData.quantity, { onChange: C.handler_changeQuantity }));
  return fragment;
};

/** @returns {Promise<DocumentFragment>} */
export function ProductPage(params) {
  return C.init(params);
}
```

- Abonnement (panier) : C passe son handler à M, `M.watchCart(C.handler_cartChange)`.
- `window.scrollTo`, `window.history` : dans une méthode de V (`V.scrollToTop`).

## 2. Templates

- `import templateError from "./error.html?raw";` — un fichier par état ou bloc.
- `{{cle}}` est échappé ; un composant s'insère par `<slot name="…">`.
- Ni condition ni boucle : un état (`disabled`, `hidden`) se règle en JS après `htmlToFragment`.
- Liens : `href="/panier" data-link`, sans le chemin du projet.
- Accessibilité : `role="status"` pour les annonces, `data-focus-key` sur les
  éléments focalisables d'un bloc reconstruit, `data-error-for` + `applyFieldErrors`
  pour les erreurs de champ.
- Tokens sémantiques uniquement (`text-ink`, `bg-action`, `bg-section`, `text-h1`).

## 3. Composant UI

```js
// Une phrase : rôle du composant et forme de ses données.
let QuantityStepperView = {
  /** @param {{quantity: number, min: number, max: number}} data
   *  @param {{onChange: (quantity: number) => void}} actions
   *  @returns {DocumentFragment} */
  dom: function (data, actions) { … }, // + html(data) si une chaîne suffit
};

export { QuantityStepperView };
```

Plusieurs boutons : un seul écouteur sur l'ancêtre (`ev.target.closest(...)`).
Classes variables : objet de classes complètes (`const SIZES = { large: "h-13 w-33" }`).

## 4. Module data

```js
let ProductData = {};

/**
 * GET /api/product?id=…
 * @param {number} id
 * @returns {Promise<{product: Object, related: Array}>}
 * @throws {ErreurApi} 404 si le produit n'existe pas.
 */
ProductData.fetchOne = async function (id) {
  return getRequest(`product?id=${encodeURIComponent(id)}`);
};

export { ProductData };
```

Prix et stock sont toujours relus depuis l'API, jamais depuis le navigateur.

## 5. Route API

```php
// back/src/routes.php
'GET  /api/cart' => [CartController::class, 'show'],

// back/index.php, dans $controleurs
CartController::class => new CartController(new ProductModel($pdo)),
```

- **Contrôleur** `final` : PHPDoc avec la route, la réponse et les codes d'erreur ;
  validation par `filter_var` ; tri par liste blanche (`private const SORTS`) ;
  termine par `Response::json([...])` ou `Response::erreur('…', 400)`.
- **Modèle** `final` : `PDO` injecté, `prepare` + marqueurs nommés ; fragments SQL
  partagés en constantes ; chaque ligne est convertie en camelCase et typée
  (`'variantId' => (int) $row['variant_id']`) ; `@return array<int, array{…}>`.
- Erreur JSON : `{ "erreur": "…", "champs": { … } }`.
- SQL : `snake_case`, identifiants `UNSIGNED`, clés étrangères et `CHECK` nommés.
