import { ProductData } from "../../data/product.js";
import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { MessageView } from "../../ui/message/index.js";
import { PaginationView } from "../../ui/pagination/index.js";
import { ProductGridView } from "../../ui/product-grid/index.js";
import { SortSelectView } from "../../ui/sort-select/index.js";
import template from "./template.html?raw";
import templateSummary from "./summary.html?raw";

/**
 * Page « Catalogue » — US DEC-b (écran Figma n° 1).
 *
 * Au premier affichage, aucun tri n'est précisé : le serveur applique le tri
 * mémorisé dans son cookie, ou « Prix croissant ». Ensuite, le tri choisi
 * accompagne chaque requête.
 *
 * Découpage MVC strict :
 *   M — état de la page, appel à l'API, préparation des données affichables ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Dossier des photos produit : front/public/images/produits/, copié tel quel
// par Vite à la racine du site (BASE dans vite.config.js).
const IMAGE_DIR = import.meta.env.BASE_URL + "images/produits/";

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
  if (sort !== undefined) {
    M.sort = sort;
  }

  try {
    let response = await ProductData.fetchPage(page, sort);
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
 * @param {{id: number, name: string, price: number, image: ?string}} product
 * @returns {{id: number, name: string, price: number, imageUrl: ?string}}
 */
M.toCardData = function (product) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    imageUrl: product.image === null ? null : IMAGE_DIR + encodeURIComponent(product.image),
  };
};

/**
 * Phrase d'accroche sous le titre, avec le nombre de produits accordé.
 *
 * @param {number} total - Nombre de produits du catalogue.
 * @returns {string} Par exemple « 18 produits · retrait gratuit en concession sous 2 h ».
 */
M.formatSummary = function (total) {
  let label = total > 1 ? "produits" : "produit";
  return `${total} ${label} · retrait gratuit en concession sous 2 h`;
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
 * @returns {{isLoading: boolean, summary: ?string, sort: string,
 *   message: ?{type: string, texte: string},
 *   products: Array<{id: number, name: string, price: number, imageUrl: ?string}>,
 *   pagination: ?{page: number, pagesTotal: number, pages: number[]}}}
 */
M.getViewData = function () {
  let catalogue = M.catalogue;

  return {
    isLoading: M.isLoading,
    summary: catalogue === null ? null : M.formatSummary(catalogue.total),
    sort: M.sort ?? DEFAULT_SORT,
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
 * Changer de tri rend la page courante sans objet : on repart de la première.
 *
 * @param {string} sort - Clé de tri choisie dans la liste.
 */
C.handler_changeSort = function (sort) {
  C.load(1, sort);
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
 * morceau par morceau.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 */
V.render = function (data) {
  let fragment = V.createPageFragment(data);
  let newRoot = fragment.firstElementChild;
  V.root.replaceWith(fragment);
  V.root = newRoot;
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
  let page = htmlToFragment(template);

  let summarySlot = page.querySelector('slot[name="summary"]');
  if (data.summary === null) {
    summarySlot.remove();
  } else {
    summarySlot.replaceWith(htmlToFragment(genericRenderer(templateSummary, { summary: data.summary })));
  }

  page
    .querySelector('slot[name="sort"]')
    .replaceWith(SortSelectView.dom({ sort: data.sort, disabled: data.isLoading }, { onSort: C.handler_changeSort }));

  page.querySelector('slot[name="message"]').replaceWith(MessageView.dom(data.message));

  let gridSlot = page.querySelector('slot[name="grid"]');
  if (data.isLoading) {
    gridSlot.replaceWith(ProductGridView.loading());
  } else if (data.message !== null) {
    gridSlot.remove();
  } else {
    gridSlot.replaceWith(ProductGridView.dom(data.products));
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
