import { AdminData } from "../../data/admin.js";
import { ProductData } from "../../data/product.js";
import { formatPrice } from "../../lib/format.js";
import { getStockStatus } from "../../lib/stock.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { StockBadgeView } from "../../ui/stock-badge/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateTable from "./table.html?raw";
import templateRow from "./row.html?raw";
import templateImage from "./image.html?raw";
import templatePlaceholder from "./placeholder.html?raw";
import templateStatus from "./status.html?raw";
import templateEmpty from "./empty.html?raw";
import templateLogin from "./login.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Produits » — US GOF-a, route /admin/produits.
 *
 * Tous les produits, en ligne ou non, avec leur catégorie, leur prix, leur
 * stock total et l'état de leur variante la plus basse. « Modifier » et
 * « + Nouveau produit » ouvrent la fiche (écran Figma n° 19, page
 * admin-product). La maquette ne montre pas cette liste : elle reprend la
 * mise en page de la gestion des catégories (écran 12).
 *
 * Découpage MVC strict :
 *   M — produits, état de la page, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Statut de publication, classes écrites en entier (voir .status-badge).
const PUBLICATION = {
  online: { label: "En ligne", modifier: "status-badge--success" },
  offline: { label: "Hors ligne", modifier: "status-badge--neutral" },
};

const SERVER_DOWN = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  response: null, // réponse de GET /api/admin/products, ou null
  state: "list", // "list", "login" ou "error"
  message: "", // message des états "login" et "error"
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.response = null;
  M.state = "list";
  M.message = "";
};

/**
 * Charge les produits. Un refus du serveur (401, 403) affiche la connexion.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  try {
    M.response = await AdminData.fetchProducts();
    M.state = "list";
  } catch (error) {
    if (error.statut === 401 || error.statut === 403) {
      M.state = "login";
      M.message =
        error.statut === 403
          ? "Vous êtes connecté avec un compte client. Connectez-vous avec un compte administrateur pour gérer les produits."
          : "Connectez-vous avec un compte administrateur pour gérer les produits.";
      return;
    }

    M.state = "error";
    M.message = error.statut === undefined ? SERVER_DOWN : `Impossible de charger les produits : ${error.message}`;
  }
};

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string} « 1 variante », « 5 variantes »…
 */
M.formatCount = function (count, singular, plural) {
  return `${count} ${count > 1 ? plural : singular}`;
};

/**
 * @param {Object} product - Produit de GET /api/admin/products.
 * @returns {{id: number, name: string, category: string, price: string, stock: string, variants: string,
 *   imageUrl: ?string, stockStatus: "in"|"low"|"out", publication: {label: string, modifier: string}}}
 *   Une ligne du tableau, prête à afficher.
 */
M.toRow = function (product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: formatPrice(product.price),
    stock: M.formatCount(product.stock, "unité", "unités"),
    variants: M.formatCount(product.variantCount, "variante", "variantes"),
    imageUrl: ProductData.imageUrl(product.image),
    // L'état du produit est celui de sa variante la plus basse : une taille
    // épuisée se voit dès la liste.
    stockStatus: getStockStatus(product.minStock, product.lowStockThreshold),
    publication: product.isActive ? PUBLICATION.online : PUBLICATION.offline,
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "list"|"login"|"error", message: string,
 *   content: ?{adminLabel: string, caption: string, rows: Array<ReturnType<typeof M.toRow>>}}}
 */
M.getViewData = function () {
  if (M.state !== "list" || M.response === null) {
    return { state: M.state, message: M.message, content: null };
  }

  return {
    state: M.state,
    message: M.message,
    content: {
      adminLabel: `${M.response.admin.firstName} (admin) · Lyon Centre`,
      caption: M.formatCount(M.response.products.length, "produit", "produits"),
      rows: M.response.products.map(M.toRow),
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
 * @returns {Promise<DocumentFragment>}
 */
C.init = async function () {
  M.reset();
  await M.load();
  return V.init(M.getViewData());
};

/**
 * « Réessayer » (état "error").
 *
 * @returns {Promise<void>}
 */
C.handler_retry = async function () {
  await M.load();
  V.render(M.getViewData());
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  content: null, // contenu affiché : liste, connexion ou erreur
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let page = htmlToFragment(template);

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit le contenu à partir de l'état.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.render = function (data) {
  V.content = replaceKeepingFocus(V.content, V.createContentFragment(data));
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} Le contenu de l'état courant.
 */
V.createContentFragment = function (data) {
  if (data.state === "login") {
    return htmlToFragment(genericRenderer(templateLogin, { message: data.message }));
  }

  if (data.content === null) {
    let fragment = htmlToFragment(genericRenderer(templateError, { message: data.message }));
    fragment.querySelector('[data-action="retry"]').addEventListener("click", C.handler_retry);
    return fragment;
  }

  let fragment = htmlToFragment(genericRenderer(templateContent, { adminLabel: data.content.adminLabel }));
  fragment.querySelector('slot[name="list"]').replaceWith(V.createListFragment(data.content.rows, data.content.caption));

  return fragment;
};

/**
 * @param {Array<ReturnType<typeof M.toRow>>} rows
 * @param {string} caption
 * @returns {DocumentFragment} Le tableau des produits, ou le message « aucun produit ».
 */
V.createListFragment = function (rows, caption) {
  if (rows.length === 0) {
    return htmlToFragment(templateEmpty);
  }

  let fragment = htmlToFragment(genericRenderer(templateTable, { caption }));
  fragment.querySelector("[data-product-rows]").append(...rows.map(V.createRowFragment));

  return fragment;
};

/**
 * @param {ReturnType<typeof M.toRow>} row
 * @returns {DocumentFragment} Une ligne du tableau.
 */
V.createRowFragment = function (row) {
  let fragment = htmlToFragment(genericRenderer(templateRow, row));

  fragment.querySelector('slot[name="image"]').replaceWith(V.createImageFragment(row.imageUrl));
  fragment.querySelector('slot[name="stock"]').replaceWith(StockBadgeView.dom(row.stockStatus));
  fragment.querySelector('slot[name="status"]').replaceWith(htmlToFragment(genericRenderer(templateStatus, row.publication)));

  return fragment;
};

/**
 * @param {?string} url - Adresse de la photo, ou null.
 * @returns {DocumentFragment} La miniature, ou « Photo à venir ».
 */
V.createImageFragment = function (url) {
  if (url === null) {
    return htmlToFragment(templatePlaceholder);
  }

  let fragment = htmlToFragment(genericRenderer(templateImage, { url }));
  // Photo absente du serveur : l'emplacement « Photo à venir » la remplace.
  let image = fragment.querySelector("img");
  image.addEventListener("error", () => image.replaceWith(htmlToFragment(templatePlaceholder)));

  return fragment;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function AdminProductsPage() {
  return C.init();
}
