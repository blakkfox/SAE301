import { CartData } from "../../data/cart.js";
import { CategoryData } from "../../data/category.js";
import { ProductData } from "../../data/product.js";
import { getStockStatus } from "../../lib/stock.js";
import {
  genericRenderer,
  htmlToFragment,
  pushQuery,
  replaceKeepingFocus,
  replacePageNumber,
  toPageNumber,
} from "../../lib/utils.js";
import { CategoryChipsView } from "../../ui/category-chips/index.js";
import { CategoryNavView } from "../../ui/category-nav/index.js";
import { MessageView } from "../../ui/message/index.js";
import { PaginationView } from "../../ui/pagination/index.js";
import { ProductCardView } from "../../ui/product-card/index.js";
import { ProductGridView } from "../../ui/product-grid/index.js";
import template from "./template.html?raw";
import templateBreadcrumbParent from "./breadcrumb-parent.html?raw";
import templateDescription from "./description.html?raw";
import templateResults from "./results.html?raw";
import templateGrid from "./grid.html?raw";
import templateEmpty from "./empty.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Catégorie » — US DEC-a (écran Figma n° 3), route /categories/:slug.
 *
 * Comme la fiche produit, C.init attend les réponses de l'API avant de rendre
 * la page : le routeur l'insère ensuite et complète lui-même ses liens. Passer
 * d'une catégorie à l'autre est une navigation du routeur ; seul le changement
 * de page de produits reconstruit une partie de la page (la zone des résultats).
 *
 * Une sous-catégorie (T-shirts…) s'affiche avec la colonne et les pastilles de
 * sa catégorie parente (Collection Honda), comme sur la maquette.
 *
 * Découpage MVC strict :
 *   M — état de la page, appels à l'API, préparation des données affichables ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Slug absent de l'arbre des catégories, ou 404 de l'API.
const NOT_FOUND = {
  title: "Catégorie introuvable",
  text: "Cette catégorie n'existe pas ou a été retirée du catalogue.",
};

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  categories: [], // arbre des catégories renvoyé par l'API
  total: 0, // nombre de produits de tout le catalogue
  slug: null, // slug de la catégorie affichée
  catalogue: null, // page de produits renvoyée par l'API, ou null
  error: null, // { title, text } si la page ne peut pas s'afficher, ou null
  pageError: null, // texte de l'erreur d'un changement de page, ou null
  isLoading: false, // un changement de page est en cours
  lastRequest: 0, // numéro de la dernière requête lancée
  addedProductId: null, // produit de la dernière carte ajoutée au panier, ou null
  cartStatus: null, // confirmation d'ajout à annoncer, ou null
};

/**
 * Remet la page dans son état initial, avant l'affichage d'une catégorie.
 * lastRequest n'est PAS remis à zéro : une réponse d'une visite précédente
 * doit rester reconnaissable comme périmée.
 */
M.reset = function () {
  M.categories = [];
  M.total = 0;
  M.slug = null;
  M.catalogue = null;
  M.error = null;
  M.pageError = null;
  M.isLoading = false;
  M.addedProductId = null;
  M.cartStatus = null;
};

/**
 * Charge les catégories et une page de produits de la catégorie, en
 * parallèle, et range les réponses dans le modèle.
 *
 * @param {string} slug - Slug lu dans l'adresse (/categories/:slug).
 * @param {number} page - Page de produits lue dans l'adresse (?page=2).
 * @returns {Promise<boolean>} true si les réponses ont été retenues, false si
 *   l'utilisateur a entre-temps demandé une autre catégorie.
 */
M.load = async function (slug, page) {
  M.lastRequest += 1;
  let request = M.lastRequest;
  M.slug = slug;

  try {
    let [tree, catalogue] = await Promise.all([
      CategoryData.fetchAll(),
      ProductData.fetchPage(page, undefined, slug),
    ]);
    if (request !== M.lastRequest) return false;
    M.categories = tree.categories;
    M.total = tree.total;
    M.catalogue = catalogue;
  } catch (error) {
    if (request !== M.lastRequest) return false;
    if (error.statut === 404) {
      M.error = NOT_FOUND;
    } else {
      M.error = {
        title: "Catégorie indisponible",
        text: `Impossible de charger la catégorie : ${error.message}`,
      };
    }
  }

  return true;
};

/**
 * Charge une autre page de produits de la catégorie affichée.
 *
 * @param {number} page - Numéro de page demandé.
 * @returns {Promise<boolean>} true si la réponse a été retenue, false si elle
 *   est périmée et doit être ignorée.
 */
M.loadPage = async function (page) {
  M.lastRequest += 1;
  let request = M.lastRequest;

  M.isLoading = true;
  M.pageError = null;
  M.addedProductId = null;
  M.cartStatus = null;

  try {
    // Sans tri précisé, le serveur applique celui mémorisé par le catalogue.
    let response = await ProductData.fetchPage(page, undefined, M.slug);
    if (request !== M.lastRequest) return false;
    M.catalogue = response;
  } catch (error) {
    if (request !== M.lastRequest) return false;
    M.pageError = `Impossible de charger les produits : ${error.message}`;
  }

  M.isLoading = false;
  return true;
};

/**
 * @param {number} page - Page de produits affichée.
 * @returns {Object<string, string>} Les réglages à inscrire dans l'adresse :
 *   rien pour la première page.
 */
M.getQuery = function (page) {
  return page > 1 ? { page: String(page) } : {};
};

/**
 * @returns {?number} La page de produits appliquée par le serveur (une page
 *   trop grande devient la dernière), ou null sans réponse.
 */
M.getDisplayedPage = function () {
  return M.catalogue?.page ?? null;
};

/**
 * Retrouve la catégorie affichée dans l'arbre, avec sa catégorie parente.
 *
 * @returns {?{category: Object, parent: ?Object}} null si le slug n'est pas
 *   dans l'arbre ; parent vaut null pour une catégorie de premier niveau.
 */
M.findCurrent = function () {
  for (let category of M.categories) {
    if (category.slug === M.slug) {
      return { category, parent: null };
    }

    let child = category.children.find((sub) => sub.slug === M.slug);
    if (child !== undefined) {
      return { category: child, parent: category };
    }
  }
  return null;
};

/**
 * @param {string} slug - Slug d'une catégorie.
 * @returns {string} Le chemin de sa page, par exemple « /categories/bagagerie ».
 */
M.categoryUrl = function (slug) {
  return `/categories/${slug}`;
};

/**
 * Nombre de produits accordé.
 *
 * @param {number} count - Nombre de produits.
 * @returns {string} Par exemple « 1 produit » ou « 6 produits ».
 */
M.formatCount = function (count) {
  let label = count > 1 ? "produits" : "produit";
  return `${count} ${label}`;
};

/**
 * Prépare une entrée de la colonne ou une pastille.
 *
 * @param {string} label - Texte affiché.
 * @param {string} url - Chemin de la page visée.
 * @param {number} count - Nombre de produits.
 * @param {boolean} isActive - true pour l'entrée en cours.
 * @returns {{label: string, url: string, count: number, countLabel: string, isActive: boolean}}
 */
M.toNavItem = function (label, url, count, isActive) {
  return { label, url, count, countLabel: M.formatCount(count), isActive };
};

/**
 * Entrées de la colonne « Catégories » : « Tous les produits », puis les
 * catégories de premier niveau.
 *
 * @param {string} activeSlug - Catégorie de premier niveau à mettre en avant.
 * @returns {Array<ReturnType<typeof M.toNavItem>>}
 */
M.getSidebarData = function (activeSlug) {
  return [
    M.toNavItem("Tous les produits", "/", M.total, false),
    ...M.categories.map((category) =>
      M.toNavItem(category.name, M.categoryUrl(category.slug), category.productCount, category.slug === activeSlug)
    ),
  ];
};

/**
 * Pastilles des sous-catégories : « Tout » (la catégorie parente), puis une
 * par sous-catégorie. Aucune pastille si la catégorie n'a pas d'enfant.
 *
 * @param {Object} section - Catégorie de premier niveau, avec ses children.
 * @returns {Array<ReturnType<typeof M.toNavItem>>}
 */
M.getChipsData = function (section) {
  if (section.children.length === 0) {
    return [];
  }

  return [
    M.toNavItem("Tout", M.categoryUrl(section.slug), section.productCount, section.slug === M.slug),
    ...section.children.map((child) =>
      M.toNavItem(child.name, M.categoryUrl(child.slug), child.productCount, child.slug === M.slug)
    ),
  ];
};

/**
 * Prépare un produit de l'API pour la carte produit.
 *
 * @param {{id: number, slug: string, name: string, price: number, priceFrom: boolean, originalPrice: ?number,
 *   discountRate: ?number, image: ?string, variantId: ?number, stock: number}} product
 * @returns {{id: number, slug: string, name: string, price: number, priceFrom: boolean, originalPrice: ?number,
 *   discountRate: ?number, imageUrl: ?string, variantId: ?number,
 *   stockStatus: "in"|"low"|"out", isAdded: boolean}}
 */
M.toCardData = function (product) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    priceFrom: product.priceFrom,
    originalPrice: product.originalPrice,
    discountRate: product.discountRate,
    imageUrl: ProductData.imageUrl(product.image),
    variantId: product.variantId,
    stockStatus: getStockStatus(product.stock, product.lowStockThreshold),
    isAdded: product.id === M.addedProductId,
  };
};

/**
 * Ajoute au panier le produit d'une carte. Seuls les produits à variante
 * unique ont un bouton d'ajout : la variante est lue dans le modèle, jamais
 * dans la page. Prépare la confirmation à annoncer.
 *
 * @param {number} productId - Produit de la carte cliquée.
 */
M.addToCart = function (productId) {
  let product = (M.catalogue?.products ?? []).find((candidate) => candidate.id === productId);
  if (product === undefined || product.variantId === null || product.stock <= 0) return;

  // Stock (STK-c) : pas plus que le stock de la variante dans le panier.
  if (CartData.remainingFor(product.variantId, product.stock) === 0) {
    M.addedProductId = null;
    M.cartStatus = CartData.limitMessage(product.name, product.stock);
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
 * Numéros de page à afficher dans la pagination.
 *
 * @param {number} pageCount - Nombre total de pages.
 * @returns {number[]} [1, 2, …, pageCount].
 */
M.getPageNumbers = function (pageCount) {
  return Array.from({ length: pageCount }, (_, index) => index + 1);
};

/**
 * Données de la zone des résultats (grille et pagination).
 *
 * @returns {{isLoading: boolean, message: ?{type: string, texte: string},
 *   products: Array<ReturnType<typeof M.toCardData>>,
 *   pagination: {page: number, pagesTotal: number, pages: number[]}}}
 */
M.getResultsData = function () {
  let catalogue = M.catalogue;

  return {
    isLoading: M.isLoading,
    message: M.pageError === null ? null : { type: "erreur", texte: M.pageError },
    products: catalogue.products.map(M.toCardData),
    pagination: {
      page: catalogue.page,
      pagesTotal: catalogue.pageCount,
      pages: M.getPageNumbers(catalogue.pageCount),
    },
  };
};

/**
 * Rassemble tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{error: ?{title: string, text: string},
 *   page: ?{name: string, countLabel: string}, description: ?string,
 *   parent: ?{name: string, url: string},
 *   sidebar: Array<ReturnType<typeof M.toNavItem>>,
 *   chips: Array<ReturnType<typeof M.toNavItem>>,
 *   results: ?ReturnType<typeof M.getResultsData>}}
 */
M.getViewData = function () {
  let current = M.error === null ? M.findCurrent() : null;

  if (current === null) {
    return { error: M.error ?? NOT_FOUND, page: null, description: null, parent: null, sidebar: [], chips: [], results: null };
  }

  // Une sous-catégorie s'affiche dans la « section » de sa catégorie parente.
  let section = current.parent ?? current.category;

  return {
    error: null,
    page: {
      name: current.category.name,
      countLabel: M.formatCount(M.catalogue.total),
    },
    description: current.category.description,
    parent: current.parent === null ? null : { name: current.parent.name, url: M.categoryUrl(current.parent.slug) },
    sidebar: M.getSidebarData(section.slug),
    chips: M.getChipsData(section),
    results: M.getResultsData(),
  };
};

// ---------------------------------------------------------------------------
// C — Contrôleur
// ---------------------------------------------------------------------------

let C = {};

/**
 * Point d'entrée de la page, appelé par le routeur avec les paramètres de
 * l'adresse. Le routeur attend la promesse avant d'afficher la page.
 *
 * @param {{slug: string}} params - Paramètres de la route /categories/:slug.
 * @returns {Promise<DocumentFragment|string>}
 */
C.init = async function (params) {
  M.reset();
  let isCurrent = await M.load(params.slug, toPageNumber(params.page));

  // Une autre catégorie a été demandée entre-temps : le routeur ignorera ce
  // contenu, et la Vue ne doit pas mémoriser une page qui ne sera pas affichée.
  if (!isCurrent) {
    return "";
  }
  V.replacePageNumber(M.getDisplayedPage(), M.slug);
  return V.init(M.getViewData());
};

/**
 * Affiche une autre page de produits : état « chargement », puis résultat.
 *
 * @param {number} page - Numéro de page cliqué.
 * @returns {Promise<void>}
 */
C.handler_changePage = async function (page) {
  let loading = M.loadPage(page);
  V.pushQuery(M.getQuery(page));
  V.renderResults(M.getResultsData());
  V.scrollToTop();

  if (await loading) {
    V.replacePageNumber(M.getDisplayedPage(), M.slug);
    V.renderResults(M.getResultsData());
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

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  results: null, // élément racine de la zone des résultats affichée
};

/**
 * Premier affichage : la page de la catégorie, ou le message d'erreur.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  if (data.error !== null) {
    return htmlToFragment(genericRenderer(templateError, data.error));
  }
  return V.createPageFragment(data);
};

/**
 * Reconstruit la zone des résultats seule, à partir des données reçues.
 *
 * @param {ReturnType<typeof M.getResultsData>} results
 */
V.renderResults = function (results) {
  let fragment = V.createResultsFragment(results);
  let newResults = fragment.firstElementChild;
  V.results.replaceWith(fragment);
  V.results = newResults;
};

/**
 * Reconstruit une carte, en gardant le focus sur son bouton.
 *
 * @param {?ReturnType<typeof M.toCardData>} card
 */
V.renderCard = function (card) {
  if (card === null) return;
  let element = V.results.querySelector(`[data-product-id="${card.id}"]`);
  if (element === null) return;
  replaceKeepingFocus(element, V.createCardFragment(card));
};

/**
 * Annonce la confirmation d'ajout au panier (zone role="status" de la grille).
 *
 * @param {?string} text
 */
V.renderCartStatus = function (text) {
  let status = V.results.querySelector("[data-grid-status]");
  if (status !== null) {
    status.textContent = text ?? "";
  }
};

/**
 * Inscrit la page de produits dans l'adresse (« Précédent », lien partagé).
 *
 * @param {ReturnType<typeof M.getQuery>} query
 */
V.pushQuery = function (query) {
  pushQuery(query);
};

/**
 * Corrige le numéro de page de l'adresse, sans nouvelle entrée d'historique.
 * Rien si l'utilisateur est allé ailleurs avant la réponse : l'adresse est
 * alors celle d'une autre page.
 *
 * @param {?number} page - Page appliquée par le serveur, ou null : rien à corriger.
 * @param {string} slug - Catégorie dont la réponse provient.
 */
V.replacePageNumber = function (page, slug) {
  let isSameCategory = decodeURIComponent(window.location.pathname).replace(/\/+$/, "").endsWith(`/categories/${slug}`);
  if (page !== null && isSameCategory) replacePageNumber(page);
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
 * Construit le fragment de la page : chaque slot reçoit son composant, ou
 * disparaît s'il n'a rien à afficher.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.createPageFragment = function (data) {
  let page = htmlToFragment(genericRenderer(template, data.page));

  let parentSlot = page.querySelector('slot[name="breadcrumb-parent"]');
  if (data.parent === null) {
    parentSlot.remove();
  } else {
    parentSlot.replaceWith(htmlToFragment(genericRenderer(templateBreadcrumbParent, data.parent)));
  }

  let descriptionSlot = page.querySelector('slot[name="description"]');
  if (data.description === null) {
    descriptionSlot.remove();
  } else {
    descriptionSlot.replaceWith(htmlToFragment(genericRenderer(templateDescription, { description: data.description })));
  }

  page.querySelector('slot[name="sidebar"]').replaceWith(CategoryNavView.dom(data.sidebar));
  page.querySelector('slot[name="chips"]').replaceWith(CategoryChipsView.dom(data.chips));

  let results = V.createResultsFragment(data.results);
  V.results = results.firstElementChild;
  page.querySelector('slot[name="results"]').replaceWith(results);

  return page;
};

/**
 * Construit la zone des résultats : message, grille (ou squelette, ou état
 * vide), puis pagination.
 *
 * @param {ReturnType<typeof M.getResultsData>} results
 * @returns {DocumentFragment}
 */
V.createResultsFragment = function (results) {
  let fragment = htmlToFragment(templateResults);

  fragment.querySelector('slot[name="message"]').replaceWith(MessageView.dom(results.message));

  let gridSlot = fragment.querySelector('slot[name="grid"]');
  if (results.isLoading) {
    gridSlot.replaceWith(ProductGridView.loading());
  } else if (results.message !== null) {
    gridSlot.remove();
  } else if (results.products.length === 0) {
    gridSlot.replaceWith(htmlToFragment(templateEmpty));
  } else {
    gridSlot.replaceWith(V.createGridFragment(results.products));
  }

  let paginationSlot = fragment.querySelector('slot[name="pagination"]');
  if (results.isLoading) {
    paginationSlot.remove();
  } else {
    paginationSlot.replaceWith(PaginationView.dom(results.pagination, { surPage: C.handler_changePage }));
  }

  return fragment;
};

/**
 * @param {Array<ReturnType<typeof M.toCardData>>} products
 * @returns {DocumentFragment} La grille 3 colonnes de la page catégorie.
 */
V.createGridFragment = function (products) {
  let fragment = htmlToFragment(templateGrid);
  let cards = products.map(V.createCardFragment);
  fragment.querySelector('slot[name="cards"]').replaceWith(...cards);
  return fragment;
};

/**
 * @param {ReturnType<typeof M.toCardData>} card
 * @returns {DocumentFragment} La carte, reliée au contrôleur.
 */
V.createCardFragment = function (card) {
  return ProductCardView.dom(card, 2, { onAdd: C.handler_addToCart });
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @param {{slug: string}} params - Paramètres de la route /categories/:slug.
 * @returns {Promise<DocumentFragment|string>}
 */
export function CategoryPage(params) {
  return C.init(params);
}
