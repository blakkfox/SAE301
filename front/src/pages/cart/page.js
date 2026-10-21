import { CartData } from "../../data/cart.js";
import { ProductData } from "../../data/product.js";
import { formatPrice } from "../../lib/format.js";
import { getStockStatus } from "../../lib/stock.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { CartLineView } from "../../ui/cart-line/index.js";
import { MessageView } from "../../ui/message/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateSummary from "./summary.html?raw";
import templateAlert from "./alert.html?raw";
import templateEmpty from "./empty.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Panier » — US CMD-b (écran Figma n° 4), route /panier.
 *
 * Le panier est gardé par le navigateur (data/cart.js) : des variantes et des
 * quantités. Les noms, photos et prix sont redemandés à l'API à chaque
 * affichage. Une variante que l'API ne renvoie plus (produit retiré du
 * catalogue) est retirée du panier, et l'utilisateur en est averti.
 *
 * Contraintes de stock (US STK-c, écran Figma n° 8) : le stock de chaque
 * variante est relu dans l'API. Une quantité supérieure au stock y est
 * ramenée au chargement, et la ligne le signale ; « + » s'arrête au stock.
 * Un article épuisé reste affiché, grisé : il est exclu du sous-total, une
 * alerte le signale et « Valider la commande » est désactivé tant qu'il
 * n'est pas retiré. Le serveur revérifie tout à la commande (CMD-a).
 *
 * Comme les autres pages, C.init attend la réponse de l'API avant de rendre
 * la page. Changer une quantité ne reconstruit que la ligne et le
 * récapitulatif ; retirer une ligne reconstruit la zone du panier.
 *
 * Découpage MVC strict :
 *   M — état de la page, panier, appel à l'API, calcul des totaux ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Note sous « Valider la commande » quand rien ne bloque la validation.
const CHECKOUT_NOTE = "Paiement sur place au moment du retrait. Vos articles sont réservés 48 h.";

// Message affiché si le navigateur refuse d'enregistrer le panier.
const STORAGE_NOTICE = {
  type: "erreur",
  texte: "Votre panier n'a pas pu être enregistré sur cet appareil : il sera perdu en quittant la page.",
};

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  items: [], // lignes du panier : [{ variantId, quantity }]
  variants: [], // variantes renvoyées par l'API (nom, photo, prix, stock…)
  adjusted: [], // variantes dont la quantité a été ramenée au stock au chargement
  error: null, // texte de l'erreur de chargement, ou null
  notice: null, // { type, texte } à afficher au-dessus du panier, ou null
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.items = [];
  M.variants = [];
  M.adjusted = [];
  M.error = null;
  M.notice = null;
};

/**
 * Lit le panier, puis demande à l'API les variantes qu'il contient. Les
 * variantes que l'API ne renvoie pas ne sont plus au catalogue : elles sont
 * retirées du panier. Les quantités sont ensuite ramenées au stock.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  M.error = null;
  M.items = CartData.read();

  if (M.items.length === 0) {
    M.variants = [];
    return;
  }

  try {
    let response = await CartData.fetchVariants(M.items.map((item) => item.variantId));
    M.variants = response.variants;
  } catch (error) {
    M.error = `Impossible de charger votre panier : ${error.message}`;
    return;
  }

  let missing = M.items.map((item) => item.variantId).filter((id) => M.findVariant(id) === undefined);

  if (missing.length > 0) {
    M.save(CartData.remove(missing));
    M.notice ??= {
      type: "erreur",
      texte:
        missing.length > 1
          ? `${missing.length} articles ne sont plus disponibles et ont été retirés de votre panier.`
          : "Un article n'est plus disponible et a été retiré de votre panier.",
    };
  }

  M.adjustToStock();
};

/**
 * Ramène au stock disponible chaque quantité qui le dépasse (US STK-c), et
 * retient les lignes concernées pour le signaler. Un article épuisé garde sa
 * quantité : il doit être retiré pour valider.
 */
M.adjustToStock = function () {
  let over = M.items.filter((item) => {
    let variant = M.findVariant(item.variantId);
    return variant !== undefined && variant.stock > 0 && item.quantity > variant.stock;
  });

  if (over.length === 0) return;

  let isSaved = true;
  for (const item of over) {
    isSaved = CartData.setQuantity(item.variantId, M.findVariant(item.variantId).stock) && isSaved;
  }

  M.adjusted = over.map((item) => item.variantId);
  M.save(isSaved);
};

/**
 * Relit le panier après une écriture, et retient l'échec éventuel.
 *
 * @param {boolean} isSaved - Résultat de l'écriture (CartData).
 */
M.save = function (isSaved) {
  M.items = CartData.read();
  if (!isSaved) {
    M.notice = STORAGE_NOTICE;
  }
};

/**
 * @param {number} variantId
 * @returns {Object|undefined} La variante renvoyée par l'API, si elle existe.
 */
M.findVariant = function (variantId) {
  return M.variants.find((variant) => variant.variantId === variantId);
};

/**
 * @param {Object} variant - Variante renvoyée par l'API.
 * @returns {boolean} true si la variante est épuisée.
 */
M.isSoldOut = function (variant) {
  return variant.stock <= 0;
};

/**
 * Change la quantité d'une ligne, sans dépasser le stock. Une ligne épuisée
 * ne change pas. La note « Quantité ajustée » disparaît : le client a repris
 * la main.
 *
 * @param {number} variantId
 * @param {number} quantity - Nouvelle quantité (bornée aussi par CartData).
 */
M.setQuantity = function (variantId, quantity) {
  let variant = M.findVariant(variantId);
  if (variant === undefined || M.isSoldOut(variant)) return;

  M.adjusted = M.adjusted.filter((id) => id !== variantId);
  M.save(CartData.setQuantity(variantId, Math.min(quantity, variant.stock)));
};

/**
 * Retire une ligne du panier.
 *
 * @param {number} variantId
 */
M.remove = function (variantId) {
  M.adjusted = M.adjusted.filter((id) => id !== variantId);
  M.save(CartData.remove([variantId]));
};

/**
 * Nombre d'articles accordé.
 *
 * @param {number} count
 * @returns {string} Par exemple « 1 article » ou « 4 articles ».
 */
M.formatCount = function (count) {
  return `${count} ${count > 1 ? "articles" : "article"}`;
};

/**
 * @param {{name: string, label: string}} variant
 * @returns {string} « Casquette Factory · Coloris rouge », ou le nom seul
 *   pour une variante « Unique ».
 */
M.formatArticle = function (variant) {
  return variant.label === "Unique" ? variant.name : `${variant.name} · ${variant.label}`;
};

/**
 * @returns {Object[]} Les variantes épuisées du panier, dans l'ordre du panier.
 */
M.getSoldOutVariants = function () {
  return M.items
    .map((item) => M.findVariant(item.variantId))
    .filter((variant) => variant !== undefined && M.isSoldOut(variant));
};

/**
 * Texte de l'alerte de stock, comme sur la maquette.
 *
 * @returns {?string} null s'il n'y a aucun article épuisé.
 */
M.getAlert = function () {
  let count = M.getSoldOutVariants().length;

  if (count === 0) return null;
  if (count === 1) {
    return "Un article de votre panier n'est plus disponible. Retirez-le pour valider votre commande.";
  }
  return `${count} articles de votre panier ne sont plus disponibles. Retirez-les pour valider votre commande.`;
};

/**
 * Prix en centimes : additionner des centimes entiers évite les erreurs
 * d'arrondi des nombres à virgule (0,1 + 0,2 ≠ 0,3).
 *
 * @param {number} price - Prix en euros.
 * @returns {number}
 */
M.toCents = function (price) {
  return Math.round(price * 100);
};

/**
 * Données d'affichage d'une ligne.
 *
 * Sous le nom : la variante (ou la référence pour une variante « Unique »),
 * puis le prix unitaire dès que la quantité dépasse 1, comme sur la maquette.
 * « + » s'arrête au stock (au moins 1, pour une ligne épuisée, désactivée).
 *
 * @param {number} variantId
 * @returns {?Parameters<typeof CartLineView.dom>[0]} null si la ligne n'existe plus.
 */
M.getLine = function (variantId) {
  let item = M.items.find((candidate) => candidate.variantId === variantId);
  let variant = M.findVariant(variantId);

  if (item === undefined || variant === undefined) {
    return null;
  }

  let details = [variant.label === "Unique" ? `Réf. ${variant.reference}` : variant.label];
  if (item.quantity > 1) {
    details.push(`${formatPrice(variant.price)} l'unité`);
  }

  return {
    variantId: variant.variantId,
    productId: variant.productId,
    name: variant.name,
    label: variant.label,
    details: details.join(" · "),
    imageUrl: ProductData.imageUrl(variant.image),
    quantity: item.quantity,
    maxQuantity: Math.max(1, Math.min(variant.stock, CartData.MAX_QUANTITY)),
    total: formatPrice((M.toCents(variant.price) * item.quantity) / 100),
    stockStatus: getStockStatus(variant.stock),
    isSoldOut: M.isSoldOut(variant),
    stockNote: M.adjusted.includes(variantId)
      ? `Quantité ajustée à ${item.quantity} : stock maximum disponible`
      : null,
  };
};

/**
 * @returns {Array<NonNullable<ReturnType<typeof M.getLine>>>} Les lignes
 *   affichables, dans l'ordre du panier.
 */
M.getLines = function () {
  return M.items.map((item) => M.getLine(item.variantId)).filter((line) => line !== null);
};

/**
 * Totaux du récapitulatif. Sans frais ni promotion pour l'instant (PRO-a,
 * PRO-c) : le total est égal au sous-total.
 *
 * Les articles épuisés (STK-c) comptent à côté du titre, mais pas dans le
 * sous-total ; tant qu'il y en a, la validation est bloquée et la note dit
 * lesquels retirer.
 *
 * @returns {{countLabel: string, subtotalLabel: string, subtotal: string,
 *   total: string, canCheckout: boolean, note: string}}
 */
M.getSummary = function () {
  let count = 0;
  let availableCount = 0;
  let cents = 0;

  for (const item of M.items) {
    let variant = M.findVariant(item.variantId);
    if (variant === undefined) continue;

    count += item.quantity;
    if (!M.isSoldOut(variant)) {
      availableCount += item.quantity;
      cents += M.toCents(variant.price) * item.quantity;
    }
  }

  let soldOut = M.getSoldOutVariants();
  let subtotalLabel = M.formatCount(availableCount);
  let note = CHECKOUT_NOTE;

  if (soldOut.length > 0) {
    subtotalLabel += availableCount > 1 ? " disponibles" : " disponible";
    note =
      soldOut.length > 1
        ? `Retirez les ${soldOut.length} articles épuisés pour pouvoir valider.`
        : `Retirez l'article épuisé (${M.formatArticle(soldOut[0])}) pour pouvoir valider.`;
  }

  return {
    countLabel: M.formatCount(count),
    subtotalLabel,
    subtotal: formatPrice(cents / 100),
    total: formatPrice(cents / 100),
    canCheckout: soldOut.length === 0,
    note,
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "error"|"empty"|"filled", error: ?string,
 *   notice: ?{type: string, texte: string}, alert: ?string,
 *   lines: ReturnType<typeof M.getLines>, summary: ReturnType<typeof M.getSummary>}}
 */
M.getViewData = function () {
  let lines = M.error === null ? M.getLines() : [];
  let state = "filled";

  if (M.error !== null) {
    state = "error";
  } else if (lines.length === 0) {
    state = "empty";
  }

  return {
    state,
    error: M.error,
    notice: M.notice,
    alert: state === "filled" ? M.getAlert() : null,
    lines,
    summary: M.getSummary(),
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
 * Clic sur « − » ou « + » d'une ligne.
 *
 * @param {number} variantId
 * @param {number} quantity - Quantité demandée.
 */
C.handler_changeQuantity = function (variantId, quantity) {
  M.setQuantity(variantId, quantity);
  V.renderLine(M.getLine(variantId));
  V.renderSummary(M.getSummary());
  V.renderNotice(M.notice);
};

/**
 * Clic sur « Retirer » : la zone du panier et l'alerte de stock sont
 * reconstruites.
 *
 * @param {number} variantId
 */
C.handler_remove = function (variantId) {
  M.remove(variantId);
  V.renderContent(M.getViewData());
  V.focusContent();
};

/**
 * Clic sur « Réessayer » après une erreur de chargement.
 *
 * @returns {Promise<void>}
 */
C.handler_retry = async function () {
  await M.load();
  V.renderContent(M.getViewData());
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  content: null, // zone du panier affichée (colonnes, panier vide ou erreur)
  summary: null, // récapitulatif affiché, ou null
  countLabel: null, // « 4 articles » à côté du titre
  alert: null, // conteneur de l'alerte de stock
  notice: null, // conteneur des messages
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let page = htmlToFragment(genericRenderer(template, { countLabel: data.summary.countLabel }));

  V.countLabel = page.querySelector("[data-cart-count-label]");
  V.alert = page.querySelector("[data-cart-alert]");
  V.notice = page.querySelector("[data-cart-notice]");
  V.renderAlert(data.alert);
  V.renderNotice(data.notice);

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit la zone du panier, le compteur, l'alerte et les messages.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.renderContent = function (data) {
  let content = V.createContentFragment(data);
  let newContent = content.firstElementChild;
  V.content.replaceWith(content);
  V.content = newContent;

  V.countLabel.textContent = data.summary.countLabel;
  V.renderAlert(data.alert);
  V.renderNotice(data.notice);
};

/**
 * Reconstruit une ligne, en gardant le focus sur le bouton utilisé.
 *
 * @param {?Parameters<typeof CartLineView.dom>[0]} line
 */
V.renderLine = function (line) {
  if (line === null) return;

  let element = V.content.querySelector(`[data-variant-id="${line.variantId}"]`);
  replaceKeepingFocus(element, V.createLineFragment(line));
};

/**
 * Reconstruit le récapitulatif et le compteur à côté du titre.
 *
 * @param {ReturnType<typeof M.getSummary>} summary
 */
V.renderSummary = function (summary) {
  V.countLabel.textContent = summary.countLabel;

  if (V.summary === null) return;
  let fragment = V.createSummaryFragment(summary);
  let newSummary = fragment.firstElementChild;
  V.summary.replaceWith(fragment);
  V.summary = newSummary;
};

/**
 * Affiche l'alerte de stock reçue, ou aucune.
 *
 * @param {?string} text
 */
V.renderAlert = function (text) {
  if (text === null) {
    V.alert.replaceChildren();
  } else {
    V.alert.replaceChildren(htmlToFragment(genericRenderer(templateAlert, { text })));
  }
};

/**
 * Affiche le message reçu, ou aucun.
 *
 * @param {?{type: string, texte: string}} notice
 */
V.renderNotice = function (notice) {
  V.notice.replaceChildren(MessageView.dom(notice));
};

/**
 * Donne le focus à la zone du panier (après le retrait d'une ligne, le
 * bouton « Retirer » utilisé n'existe plus).
 */
V.focusContent = function () {
  V.content.focus();
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} Les colonnes du panier, le panier vide ou l'erreur.
 */
V.createContentFragment = function (data) {
  V.summary = null;

  if (data.state === "error") {
    let fragment = htmlToFragment(genericRenderer(templateError, { text: data.error }));
    fragment.querySelector("[data-retry]").addEventListener("click", C.handler_retry);
    return fragment;
  }

  if (data.state === "empty") {
    return htmlToFragment(templateEmpty);
  }

  let fragment = htmlToFragment(templateContent);
  fragment.querySelector('slot[name="lines"]').replaceWith(...data.lines.map(V.createLineFragment));

  let summary = V.createSummaryFragment(data.summary);
  V.summary = summary.firstElementChild;
  fragment.querySelector('slot[name="summary"]').replaceWith(summary);

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getSummary>} summary
 * @returns {DocumentFragment} Le récapitulatif, avec le lien « Valider la
 *   commande », ou le bouton désactivé si un article épuisé bloque la validation.
 */
V.createSummaryFragment = function (summary) {
  let fragment = htmlToFragment(genericRenderer(templateSummary, summary));
  let unused = summary.canCheckout ? "[data-checkout-blocked]" : "[data-checkout-link]";
  fragment.querySelector(unused).remove();
  return fragment;
};

/**
 * @param {Parameters<typeof CartLineView.dom>[0]} line
 * @returns {DocumentFragment} La ligne, reliée au contrôleur.
 */
V.createLineFragment = function (line) {
  return CartLineView.dom(line, { onQuantity: C.handler_changeQuantity, onRemove: C.handler_remove });
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function CartPage() {
  return C.init();
}
