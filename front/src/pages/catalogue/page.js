import { CartData } from "../../data/cart.js";
import { ProductData } from "../../data/product.js";
import { LOW_STOCK_MAX, getStockStatus } from "../../lib/stock.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { MessageView } from "../../ui/message/index.js";
import { PaginationView } from "../../ui/pagination/index.js";
import { ProductCardView } from "../../ui/product-card/index.js";
import { ProductGridView } from "../../ui/product-grid/index.js";
import { SoldOutToggleView } from "../../ui/sold-out-toggle/index.js";
import { SortSelectView } from "../../ui/sort-select/index.js";
import { StockBadgeView } from "../../ui/stock-badge/index.js";
import template from "./template.html?raw";
import templateSummary from "./summary.html?raw";
import templateLegend from "./legend.html?raw";
import templateEmptyInStock from "./empty-in-stock.html?raw";

/**
 * Page « Catalogue » — US DEC-b (écran Figma n° 1).
 *
 * Au premier affichage, aucun tri n'est précisé : le serveur applique le tri
 * mémorisé dans son cookie, ou « Prix croissant ». Ensuite, le tri choisi
 * accompagne chaque requête.
 *
 * Stocks (US STK-b, écran Figma n° 7) : chaque carte porte une pastille
 * « En stock », « Bientôt épuisé » ou « Épuisé », expliquée par la légende
 * sous la grille. « Masquer les produits épuisés » est filtré par le serveur,
 * pour que le nombre de produits et la pagination restent justes.
 *
 * Découpage MVC strict :
 *   M — état de la page, appel à l'API, préparation des données affichables ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Tri affiché tant que le serveur n'a pas répondu ; identique au tri par
// défaut du serveur (CatalogueController::DEFAULT_SORT).
const DEFAULT_SORT = "price_asc";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  catalogue: null, // dernière réponse de l'API, ou null
  sort: null, // tri demandé ou appliqué, ou null avant la première réponse
  error: null, // texte de l'erreur à afficher, ou null
  isLoading: false, // une requête est en cours
  lastRequest: 0, // numéro de la dernière requête lancée
  addedProductId: null, // produit de la dernière carte ajoutée au panier, ou null
  cartStatus: null, // confirmation d'ajout à annoncer, ou null
  hideSoldOut: false, // « Masquer les produits épuisés » est coché
};

/**
 * Remet la page dans son état initial, avant un nouvel affichage.
 * lastRequest n'est PAS remis à zéro : une réponse d'une visite précédente
 * doit rester reconnaissable comme périmée.
 */
M.reset = function () {
  M.catalogue = null;
  M.sort = null;
  M.error = null;
  M.isLoading = false;
  M.addedProductId = null;
  M.cartStatus = null;
  M.hideSoldOut = false;
};

/**
 * Coche ou décoche « Masquer les produits épuisés ».
 *
 * @param {boolean} hideSoldOut
 */
M.setHideSoldOut = function (hideSoldOut) {
  M.hideSoldOut = hideSoldOut;
};

/**
 * Charge une page du catalogue et range la réponse dans le modèle.
 *
 * Si l'utilisateur clique plusieurs fois rapidement, plusieurs requêtes se
 * croisent : seule la réponse de la DERNIÈRE est retenue, sinon une réponse
 * lente pourrait écraser une réponse plus récente.
 *
 * @param {number} page - Numéro de page demandé.
 * @param {string} [sort] - Clé de tri ; absente, le serveur choisit.
 * @returns {Promise<boolean>} true si la réponse a été retenue, false si elle
 *   est périmée et doit être ignorée.
 */
M.loadPage = async function (page, sort) {
  M.lastRequest += 1;
  let request = M.lastRequest;

  M.isLoading = true;
  M.error = null;
  M.addedProductId = null;
  M.cartStatus = null;
  if (sort !== undefined) {
    M.sort = sort;
  }

  try {
    let response = await ProductData.fetchPage(page, sort, undefined, M.hideSoldOut);
    if (request !== M.lastRequest) return false;
    M.catalogue = response;
    M.sort = response.sort;
  } catch (error) {
    if (request !== M.lastRequest) return false;
    M.catalogue = null;
    M.error = `Impossible de charger le catalogue : ${error.message}`;
  }

  M.isLoading = false;
  return true;
};

/**
 * Prépare un produit de l'API pour la carte produit.
 *
 * @param {{id: number, name: string, price: number, image: ?string, variantId: ?number,
 *   stock: number, lowStockThreshold: number}} product
 * @returns {{id: number, name: string, price: number, imageUrl: ?string,
 *   variantId: ?number, stockStatus: "in"|"low"|"out", isAdded: boolean}}
 */
M.toCardData = function (product) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    imageUrl: ProductData.imageUrl(product.image),
    variantId: product.variantId,
    stockStatus: getStockStatus(product.stock, product.lowStockThreshold),
    isAdded: product.id === M.addedProductId,
  };
};

/**
 * Ajoute au panier le produit d'une carte. Seuls les produits à variante
 * unique et en stock ont un bouton d'ajout : la variante est lue dans le
 * modèle, jamais dans la page. Prépare la confirmation à annoncer.
 *
 * @param {number} productId - Produit de la carte cliquée.
 */
M.addToCart = function (productId) {
  let product = (M.catalogue?.products ?? []).find((candidate) => candidate.id === productId);
  if (product === undefined || product.variantId === null || product.stock <= 0) return;

  // Stock (STK-c) : pas plus que le stock de la variante dans le panier.
  if (CartData.remainingFor(product.variantId, product.stock) === 0) {
    M.addedProductId = null;
    M.cartStatus = `Votre panier contient déjà tout le stock disponible de ${product.name}.`;
    return;
  }

  if (CartData.add(product.variantId, 1)) {
    M.addedProductId = productId;
    M.cartStatus = `${product.name} ajouté au panier.`;
  } else {
    M.addedProductId = null;
    M.cartStatus = "Le panier n'a pas pu être enregistré sur cet appareil.";
  }
};

/**
 * @param {number} productId
 * @returns {?ReturnType<typeof M.toCardData>} La carte d'un produit de la page affichée, ou null.
 */
M.getCard = function (productId) {
  let product = (M.catalogue?.products ?? []).find((candidate) => candidate.id === productId);
  return product === undefined ? null : M.toCardData(product);
};


/**
 * Phrase d'accroche sous le titre, avec le nombre de produits accordé.
 *
 * @param {number} total - Nombre de produits du catalogue.
 * @returns {string} Par exemple « 18 produits · stock en temps réel de la concession Lyon Centre ».
 */
M.formatSummary = function (total) {
  let label = total > 1 ? "produits" : "produit";
  let inStock = M.hideSoldOut ? " en stock" : "";
  return `${total} ${label}${inStock} · stock en temps réel de la concession Lyon Centre`;
};

/**
 * Textes de la légende des pastilles. Le seuil est propre à chaque produit
 * (US GOF-a) : la légende cite celui par défaut de lib/stock.js.
 *
 * @returns {{inText: string, lowText: string, outText: string}}
 */
M.getLegendData = function () {
  return {
    inText: `au-dessus du seuil d’alerte (${LOW_STOCK_MAX} unités en général)`,
    lowText: "seuil d’alerte atteint, quelques unités restantes",
    outText: "0 unité, ajout au panier impossible",
  };
};

/**
 * Numéros de page à afficher dans la pagination.
 *
 * @param {number} pageCount - Nombre total de pages.
 * @returns {number[]} [1, 2, …, pageCount].
 */
M.getPageNumbers = function (pageCount) {
  return Array.from({ length: pageCount }, (_, index) => index + 1);
};

/**
 * Rassemble tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{isLoading: boolean, summary: ?string, sort: string, hideSoldOut: boolean,
 *   message: ?{type: string, texte: string},
 *   products: Array<ReturnType<typeof M.toCardData>>,
 *   legend: ReturnType<typeof M.getLegendData>,
 *   pagination: ?{page: number, pagesTotal: number, pages: number[]}}}
 */
M.getViewData = function () {
  let catalogue = M.catalogue;

  return {
    isLoading: M.isLoading,
    summary: catalogue === null ? null : M.formatSummary(catalogue.total),
    sort: M.sort ?? DEFAULT_SORT,
    hideSoldOut: M.hideSoldOut,
    legend: M.getLegendData(),
    message: M.error === null ? null : { type: "erreur", texte: M.error },
    products: catalogue === null ? [] : catalogue.products.map(M.toCardData),
    pagination:
      catalogue === null
        ? null
        : {
            page: catalogue.page,
            pagesTotal: catalogue.pageCount,
            pages: M.getPageNumbers(catalogue.pageCount),
          },
  };
};

// ---------------------------------------------------------------------------
// C — Contrôleur
// ---------------------------------------------------------------------------

let C = {};

/**
 * Point d'entrée de la page, appelé par le routeur.
 *
 * La page s'affiche tout de suite en état « chargement » ; la grille la
 * remplace dès que l'API a répondu.
 *
 * @returns {DocumentFragment} La page, à insérer par le routeur.
 */
C.init = function () {
  M.reset();
  let loading = M.loadPage(1);
  let fragment = V.init(M.getViewData());
  C.renderWhenLoaded(loading);
  return fragment;
};

/**
 * Lance un chargement : affiche l'état « chargement », puis le résultat.
 *
 * @param {number} page - Numéro de page demandé.
 * @param {string} sort - Clé de tri.
 * @returns {Promise<void>}
 */
C.load = function (page, sort) {
  let loading = M.loadPage(page, sort);
  V.render(M.getViewData());
  return C.renderWhenLoaded(loading);
};

/**
 * Réaffiche la page quand le chargement est terminé, sauf si sa réponse a été
 * dépassée par une requête plus récente.
 *
 * @param {Promise<boolean>} loading - Résultat de M.loadPage.
 * @returns {Promise<void>}
 */
C.renderWhenLoaded = async function (loading) {
  if (await loading) {
    V.render(M.getViewData());
  }
};

/**
 * Clic sur « Ajouter au panier » d'une carte : la carte affiche « Ajouté au
 * panier ✓ » et la confirmation est annoncée. Le compteur de l'en-tête se met
 * à jour seul (voir le layout).
 *
 * @param {number} productId - Produit de la carte cliquée.
 */
C.handler_addToCart = function (productId) {
  let previous = M.addedProductId;
  M.addToCart(productId);

  // La carte précédemment « ajoutée » redevient « Ajouter au panier ».
  if (previous !== null && previous !== productId) {
    V.renderCard(M.getCard(previous));
  }
  V.renderCard(M.getCard(productId));
  V.renderCartStatus(M.cartStatus);
};

/**
 * Changer de tri rend la page courante sans objet : on repart de la première.
 *
 * @param {string} sort - Clé de tri choisie dans la liste.
 */
C.handler_changeSort = function (sort) {
  C.load(1, sort);
};

/**
 * Clic sur « Masquer les produits épuisés » : la liste filtrée repart de la
 * première page, avec le tri en cours.
 *
 * @param {boolean} hideSoldOut - Nouvel état de la case.
 */
C.handler_toggleSoldOut = function (hideSoldOut) {
  M.setHideSoldOut(hideSoldOut);
  C.load(1, M.sort ?? DEFAULT_SORT);
};

/**
 * Affiche une autre page, avec le tri en cours, et remonte en haut de liste.
 *
 * @param {number} page - Numéro de page cliqué.
 */
C.handler_changePage = function (page) {
  C.load(page, M.sort ?? DEFAULT_SORT);
  V.scrollToTop();
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  root: null, // élément racine de la page affichée
};

/**
 * Premier affichage.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let fragment = V.createPageFragment(data);
  V.root = fragment.firstElementChild;
  return fragment;
};

/**
 * Reconstruit toute la page à partir des données reçues, et remplace
 * l'ancienne : l'affichage se déduit de l'état, on ne le retouche pas
 * morceau par morceau. Le focus est rendu à la case « Masquer les produits
 * épuisés » si c'est elle qui l'avait.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 */
V.render = function (data) {
  V.root = replaceKeepingFocus(V.root, V.createPageFragment(data));
};

/**
 * Reconstruit une carte, en gardant le focus sur son bouton.
 *
 * @param {?ReturnType<typeof M.toCardData>} card
 */
V.renderCard = function (card) {
  if (card === null) return;
  let element = V.root.querySelector(`[data-product-id="${card.id}"]`);
  if (element === null) return;
  replaceKeepingFocus(element, V.createCardFragment(card));
};

/**
 * Annonce la confirmation d'ajout au panier (zone role="status" de la grille).
 *
 * @param {?string} text
 */
V.renderCartStatus = function (text) {
  let status = V.root.querySelector("[data-grid-status]");
  if (status !== null) {
    status.textContent = text ?? "";
  }
};

/**
 * @param {ReturnType<typeof M.toCardData>} card
 * @returns {DocumentFragment} La carte, reliée au contrôleur.
 */
V.createCardFragment = function (card) {
  return ProductCardView.dom(card, 2, { onAdd: C.handler_addToCart });
};

/**
 * Remonte en haut de la page, sans animation si l'utilisateur a demandé à
 * réduire les mouvements.
 */
V.scrollToTop = function () {
  let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
};

/**
 * @param {ReturnType<typeof M.getLegendData>} legend
 * @returns {DocumentFragment} La légende, avec une pastille par statut.
 */
V.createLegendFragment = function (legend) {
  let fragment = htmlToFragment(genericRenderer(templateLegend, legend));
  fragment.querySelector('slot[name="in"]').replaceWith(StockBadgeView.dom("in"));
  fragment.querySelector('slot[name="low"]').replaceWith(StockBadgeView.dom("low"));
  fragment.querySelector('slot[name="out"]').replaceWith(StockBadgeView.dom("out"));
  return fragment;
};

/**
 * Construit le fragment de la page : chaque slot reçoit son composant, ou
 * disparaît s'il n'a rien à afficher.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.createPageFragment = function (data) {
  let page = htmlToFragment(template);

  let summarySlot = page.querySelector('slot[name="summary"]');
  if (data.summary === null) {
    summarySlot.remove();
  } else {
    summarySlot.replaceWith(htmlToFragment(genericRenderer(templateSummary, { summary: data.summary })));
  }

  page
    .querySelector('slot[name="stock-filter"]')
    .replaceWith(SoldOutToggleView.dom({ checked: data.hideSoldOut }, { onToggle: C.handler_toggleSoldOut }));

  page
    .querySelector('slot[name="sort"]')
    .replaceWith(SortSelectView.dom({ sort: data.sort, disabled: data.isLoading }, { onSort: C.handler_changeSort }));

  page.querySelector('slot[name="message"]').replaceWith(MessageView.dom(data.message));

  let gridSlot = page.querySelector('slot[name="grid"]');
  if (data.isLoading) {
    gridSlot.replaceWith(ProductGridView.loading());
  } else if (data.message !== null) {
    gridSlot.remove();
  } else if (data.products.length === 0 && data.hideSoldOut) {
    gridSlot.replaceWith(htmlToFragment(templateEmptyInStock));
  } else {
    gridSlot.replaceWith(ProductGridView.dom(data.products, 2, { onAdd: C.handler_addToCart }));
  }

  let legendSlot = page.querySelector('slot[name="legend"]');
  if (data.isLoading || data.products.length === 0) {
    legendSlot.remove();
  } else {
    legendSlot.replaceWith(V.createLegendFragment(data.legend));
  }

  let paginationSlot = page.querySelector('slot[name="pagination"]');
  if (data.isLoading || data.pagination === null) {
    paginationSlot.remove();
  } else {
    paginationSlot.replaceWith(PaginationView.dom(data.pagination, { surPage: C.handler_changePage }));
  }

  return page;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {DocumentFragment}
 */
export function CataloguePage() {
  return C.init();
}
