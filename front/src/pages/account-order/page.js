import { AuthData } from "../../data/auth.js";
import { CartData } from "../../data/cart.js";
import { OrderData } from "../../data/order.js";
import { ProductData } from "../../data/product.js";
import { formatPrice } from "../../lib/format.js";
import { formatOrderDate, formatOrderNumber, formatPickupLong } from "../../lib/order.js";
import { getStockStatus } from "../../lib/stock.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { AccountMenuView } from "../../ui/account-menu/index.js";
import { MessageView } from "../../ui/message/index.js";
import { OrderStatusBadgeView } from "../../ui/order-status-badge/index.js";
import { StockBadgeView } from "../../ui/stock-badge/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateActions from "./actions.html?raw";
import templateLine from "./line.html?raw";
import templateImage from "./image.html?raw";
import templatePlaceholder from "./placeholder.html?raw";
import templateUnavailable from "./unavailable.html?raw";
import templateLogin from "./login.html?raw";
import templateNotFound from "./not-found.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Commander à nouveau » — US SUI-a (écran Figma n° 15), route
 * /compte/commandes/:id.
 *
 * Une commande du compte connecté (GET /api/order) : ses articles, au prix
 * payé, et leur disponibilité actuelle. « Commander à nouveau » remet ses
 * articles dans le panier (data/cart.js), avec les contraintes de stock de
 * STK-c : juste avant l'ajout, le stock est relu dans l'API (GET /api/cart) ;
 * un article épuisé ou retiré du catalogue n'est pas ajouté, et une
 * quantité est limitée à ce qu'il reste possible d'ajouter
 * (CartData.remainingFor). Un message dit ce qui a été ajouté et ce qui ne
 * l'a pas été. Prix et stock sont revérifiés par le serveur à la validation
 * (CMD-a).
 *
 * Seuls la variante et la quantité sont reprises : le panier en relit le nom,
 * la photo et le prix actuel.
 *
 * Découpage MVC strict :
 *   M — commande, stock actuel, ajout au panier, messages, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Classes d'un article qui peut être commandé ou non, écrites en entier
// (comme TONES dans ui/cart-line/index.js).
const TONES = {
  available: { visualClasses: "", nameClasses: "text-ink", priceClasses: "text-ink" },
  unavailable: { visualClasses: "opacity-45", nameClasses: "text-ink-muted", priceClasses: "text-ink-muted" },
};

const SERVER_DOWN = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";

// Message affiché si le navigateur refuse d'enregistrer le panier (comme la page Panier).
const STORAGE_NOTICE = {
  type: "erreur",
  texte: "Votre panier n'a pas pu être enregistré sur cet appareil : il sera perdu en quittant la page.",
};

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  id: 0, // identifiant demandé dans l'adresse
  order: null, // commande renvoyée par GET /api/order, ou null
  variants: null, // variantes de la commande encore au catalogue (GET /api/cart), ou null si non lues
  state: "ready", // "ready", "login", "not-found" ou "error"
  errorMessage: "", // message de l'état "error"
  notice: null, // { type, texte } au-dessus des articles, ou null
  hasAdded: false, // au moins un article a été mis au panier : le lien « Voir mon panier » apparaît
  isReordering: false, // l'ajout au panier est en cours
  isLoggingOut: false, // la déconnexion est en cours
};

/**
 * Remet la page dans son état initial.
 *
 * @param {string} id - Paramètre :id de l'adresse.
 */
M.reset = function (id) {
  M.id = Number(id);
  M.order = null;
  M.variants = null;
  M.state = "ready";
  M.errorMessage = "";
  M.notice = null;
  M.hasAdded = false;
  M.isReordering = false;
  M.isLoggingOut = false;
};

/**
 * @returns {number[]} Variantes de la commande qui existent encore (une
 *   variante supprimée depuis vaut null dans la ligne).
 */
M.getVariantIds = function () {
  return M.order.lines.map((line) => line.variantId).filter((id) => id !== null);
};

/**
 * Relit le stock, la photo et la présence au catalogue des variantes de la
 * commande (GET /api/cart, comme le panier).
 *
 * @returns {Promise<void>}
 * @throws {ErreurApi} Si le serveur répond par une erreur.
 */
M.loadVariants = async function () {
  let ids = M.getVariantIds();
  M.variants = ids.length === 0 ? [] : (await CartData.fetchVariants(ids)).variants;
};

/**
 * Charge la commande, puis le stock de ses articles. Si seul le stock ne
 * peut pas être lu, la commande est affichée sans disponibilité.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  if (!Number.isInteger(M.id) || M.id < 1) {
    M.state = "not-found";
    return;
  }

  try {
    M.order = (await OrderData.fetchOne(M.id)).order;
    M.state = "ready";
  } catch (error) {
    M.order = null;
    if (error.statut === 401) {
      M.state = "login";
    } else if (error.statut === 404 || error.statut === 400) {
      M.state = "not-found";
    } else {
      M.state = "error";
      M.errorMessage = error.statut === undefined ? SERVER_DOWN : `Impossible de charger la commande : ${error.message}`;
    }
    return;
  }

  try {
    await M.loadVariants();
  } catch (error) {
    M.variants = null;
    M.notice = { type: "erreur", texte: "La disponibilité des articles n’a pas pu être vérifiée." };
  }
};

/**
 * @param {?number} variantId
 * @returns {Object|undefined} La variante actuelle (GET /api/cart), si elle est encore au catalogue.
 */
M.findVariant = function (variantId) {
  return M.variants?.find((variant) => variant.variantId === variantId);
};

/**
 * @param {{name: string, label: string}} line
 * @returns {string} « T-shirt Capsule (L) », « Casquette Factory (rouge) »,
 *   ou le nom seul pour une variante « Unique » : comme dans le message de la maquette.
 */
M.formatArticle = function (line) {
  return line.label === "Unique" ? line.name : `${line.name} (${line.label.replace(/^(Taille|Coloris) /, "")})`;
};

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string} « 1 article », « 3 articles »…
 */
M.formatCount = function (count, singular, plural) {
  return `${count} ${count > 1 ? plural : singular}`;
};

/**
 * @param {string} singular - Début de phrase au singulier.
 * @param {string} plural - Début de phrase au pluriel.
 * @param {string[]} names - Articles concernés.
 * @returns {?string} « Article épuisé, non ajouté : Casquette Factory (rouge). », ou null sans article.
 */
M.formatGroup = function (singular, plural, names) {
  if (names.length === 0) return null;
  return `${names.length > 1 ? plural : singular} : ${names.join(", ")}.`;
};

/**
 * Début de l'ajout au panier : un seul à la fois.
 *
 * @returns {boolean} false si un ajout est déjà en cours.
 */
M.startReorder = function () {
  if (M.isReordering || M.order === null) return false;

  M.isReordering = true;
  M.notice = null;
  return true;
};

/**
 * Remet les articles de la commande dans le panier (US SUI-a), d'après le
 * stock relu à l'instant (US STK-c). Chaque article est ajouté dans la limite
 * de ce que le panier peut encore recevoir : CartData.remainingFor tient
 * compte du stock, de la quantité maximale d'une ligne et de ce qui est déjà
 * dans le panier. À appeler après M.startReorder.
 *
 * @returns {Promise<void>}
 */
M.reorder = async function () {
  try {
    await M.loadVariants();
  } catch (error) {
    M.notice = {
      type: "erreur",
      texte:
        error.statut === undefined
          ? SERVER_DOWN
          : `Le stock n’a pas pu être vérifié, rien n’a été ajouté : ${error.message}`,
    };
    M.isReordering = false;
    return;
  }

  let added = 0;
  let isSaved = true;
  let soldOut = [];
  let removed = [];
  let full = [];
  let limited = [];

  for (const line of M.order.lines) {
    let variant = M.findVariant(line.variantId);
    let name = M.formatArticle(line);

    if (variant === undefined) {
      removed.push(name);
      continue;
    }
    if (variant.stock <= 0) {
      soldOut.push(name);
      continue;
    }

    let quantity = Math.min(line.quantity, CartData.remainingFor(variant.variantId, variant.stock));
    if (quantity === 0) {
      full.push(name);
      continue;
    }

    isSaved = CartData.add(variant.variantId, quantity) && isSaved;
    added += quantity;
    if (quantity < line.quantity) {
      limited.push(`${name}, ${quantity} sur ${line.quantity}`);
    }
  }

  let sentences = [
    added > 0
      ? `${M.formatCount(added, "article ajouté", "articles ajoutés")} au panier.`
      : "Aucun article n’a pu être ajouté au panier.",
    // Limite du stock, ou de la quantité maximale d'une ligne avec ce que le panier contenait déjà.
    M.formatGroup("Quantité limitée", "Quantités limitées", limited),
    M.formatGroup("Article épuisé, non ajouté", "Articles épuisés, non ajoutés", soldOut),
    M.formatGroup("Article retiré du catalogue, non ajouté", "Articles retirés du catalogue, non ajoutés", removed),
    M.formatGroup("Article déjà au maximum dans votre panier", "Articles déjà au maximum dans votre panier", full),
  ];

  M.hasAdded = M.hasAdded || added > 0;
  M.notice = isSaved
    ? { type: added > 0 ? "succes" : "erreur", texte: sentences.filter((sentence) => sentence !== null).join(" ") }
    : STORAGE_NOTICE;
  M.isReordering = false;
};

/**
 * Début de la déconnexion : une seule à la fois.
 *
 * @returns {boolean} false si une déconnexion est déjà en cours.
 */
M.startLogout = function () {
  if (M.isLoggingOut) return false;

  M.isLoggingOut = true;
  M.notice = null;
  return true;
};

/**
 * Déconnexion : en cas de succès, la page invite à se reconnecter. À
 * appeler après M.startLogout.
 *
 * @returns {Promise<void>}
 */
M.logout = async function () {
  try {
    await AuthData.logout();
    M.state = "login";
    M.order = null;
    M.variants = null;
    M.notice = { type: "succes", texte: "Vous êtes déconnecté." };
  } catch (error) {
    M.notice = {
      type: "erreur",
      texte: error.statut === undefined ? SERVER_DOWN : `La déconnexion a échoué : ${error.message}`,
    };
  }

  M.isLoggingOut = false;
};

/**
 * @param {string} status - Statut recherché dans le journal.
 * @returns {?string} Date du passage à ce statut (« 19/09/2026 »), ou null s'il n'est pas journalisé.
 */
M.findEventDate = function (status) {
  let event = M.order.events.find((candidate) => candidate.status === status);
  return event === undefined ? null : formatOrderDate(event.createdAt);
};

/**
 * @returns {string} La ligne sous le titre, selon le statut : « Passée le
 *   18/09/2026 · retirée le 19/09/2026 à Honda Moto Lyon Centre »…
 */
M.getSummary = function () {
  let order = M.order;
  let placed = `Passée le ${formatOrderDate(order.createdAt)}`;
  let dealership = order.dealership.name;

  if (order.status === "retiree") {
    // Commande antérieure au journal des statuts : le jour du créneau.
    let date = M.findEventDate("retiree") ?? formatOrderDate(order.pickupStart);
    return `${placed} · retirée le ${date} à ${dealership}`;
  }
  if (order.status === "annulee") {
    let date = M.findEventDate("annulee");
    return `${placed} · annulée${date === null ? "" : ` le ${date}`}`;
  }
  return `${placed} · retrait ${formatPickupLong(order.pickupStart, order.pickupEnd, order.dayOffset)} à ${dealership}`;
};

/**
 * Prix en centimes, pour éviter les erreurs d'arrondi (comme la page Panier).
 *
 * @param {number} price - Prix en euros.
 * @returns {number}
 */
M.toCents = function (price) {
  return Math.round(price * 100);
};

/**
 * Données d'affichage d'un article : prix payé à la commande, et
 * disponibilité actuelle (null si le stock n'a pas pu être lu). « En stock »
 * n'est pas affiché, comme sur la maquette : seuls les articles qui posent
 * problème sont signalés.
 *
 * @param {Object} line - Ligne de la commande.
 * @returns {{name: string, details: string, price: string, imageUrl: ?string,
 *   availability: ?("in"|"low"|"out"|"removed"), visualClasses: string, nameClasses: string,
 *   priceClasses: string}}
 */
M.getLine = function (line) {
  let variant = M.findVariant(line.variantId);

  let availability = null;
  if (M.variants !== null) {
    availability = variant === undefined ? "removed" : getStockStatus(variant.stock);
  }

  let isUnavailable = availability === "out" || availability === "removed";
  let quantity = `× ${line.quantity}`;

  return {
    name: line.name,
    details: line.label === "Unique" ? quantity : `${line.label} · ${quantity}`,
    price: formatPrice((M.toCents(line.unitPrice) * line.quantity) / 100),
    imageUrl: variant === undefined ? null : ProductData.imageUrl(variant.image),
    availability: availability === "in" ? null : availability,
    ...(isUnavailable ? TONES.unavailable : TONES.available),
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "ready"|"login"|"not-found"|"error", notice: ?{type: string, texte: string},
 *   errorMessage: string, menu: {current: string, logoutLabel: string, isLoggingOut: boolean},
 *   order: ?{number: string, status: string, summary: string,
 *     actions: {reorderLabel: string, isReordering: boolean, hasAdded: boolean},
 *     lines: Array<ReturnType<typeof M.getLine>>}}}
 */
M.getViewData = function () {
  return {
    state: M.state,
    notice: M.notice,
    errorMessage: M.errorMessage,
    menu: {
      current: "orders",
      logoutLabel: M.isLoggingOut ? "Déconnexion…" : "Déconnexion",
      isLoggingOut: M.isLoggingOut,
    },
    order:
      M.state !== "ready" || M.order === null
        ? null
        : {
            number: formatOrderNumber(M.order.id),
            status: M.order.status,
            summary: M.getSummary(),
            actions: {
              reorderLabel: M.isReordering ? "Ajout en cours…" : "Commander à nouveau",
              isReordering: M.isReordering,
              hasAdded: M.hasAdded,
            },
            lines: M.order.lines.map(M.getLine),
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
 * @param {{id: string}} params - Paramètres de l'adresse /compte/commandes/:id.
 * @returns {Promise<DocumentFragment>}
 */
C.init = async function (params) {
  M.reset(params.id);
  await M.load();
  return V.init(M.getViewData());
};

/**
 * « Commander à nouveau » : le stock est relu, puis les articles sont mis au panier.
 *
 * @returns {Promise<void>}
 */
C.handler_reorder = async function () {
  if (!M.startReorder()) return;
  V.render(M.getViewData());
  await M.reorder();
  V.render(M.getViewData());
};

/**
 * « Déconnexion » dans le menu du compte.
 *
 * @returns {Promise<void>}
 */
C.handler_logout = async function () {
  if (!M.startLogout()) return;
  V.render(M.getViewData());
  await M.logout();
  V.render(M.getViewData());
  V.focusTitle();
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
  menu: null, // menu « Mon compte » affiché
  content: null, // contenu affiché : commande, connexion, introuvable ou erreur
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let page = htmlToFragment(template);

  let menu = V.createMenuFragment(data.menu);
  V.menu = menu.firstElementChild;
  page.querySelector('slot[name="menu"]').replaceWith(menu);

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit le menu et le contenu à partir de l'état.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.render = function (data) {
  V.menu = replaceKeepingFocus(V.menu, V.createMenuFragment(data.menu));
  V.content = replaceKeepingFocus(V.content, V.createContentFragment(data));
};

/**
 * Donne le focus au titre de la page (après la déconnexion, dont le bouton
 * était devenu inactif).
 */
V.focusTitle = function () {
  V.content.querySelector("h1").focus();
};

/**
 * @param {ReturnType<typeof M.getViewData>["menu"]} menu
 * @returns {DocumentFragment} Le menu « Mon compte ».
 */
V.createMenuFragment = function (menu) {
  return AccountMenuView.dom(menu, { onLogout: C.handler_logout });
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} Le contenu de l'état courant, avec ses messages.
 */
V.createContentFragment = function (data) {
  let fragment;

  if (data.state === "login") {
    fragment = htmlToFragment(templateLogin);
  } else if (data.state === "not-found") {
    fragment = htmlToFragment(templateNotFound);
  } else if (data.state === "error" || data.order === null) {
    fragment = htmlToFragment(genericRenderer(templateError, { message: data.errorMessage }));
    fragment.querySelector('[data-action="retry"]').addEventListener("click", C.handler_retry);
  } else {
    fragment = V.createOrderFragment(data.order);
  }

  fragment.querySelector("[data-order-notice]").replaceChildren(MessageView.dom(data.notice));
  return fragment;
};

/**
 * @param {NonNullable<ReturnType<typeof M.getViewData>["order"]>} order
 * @returns {DocumentFragment} En-tête, bouton et articles de la commande.
 */
V.createOrderFragment = function (order) {
  let fragment = htmlToFragment(genericRenderer(templateContent, order));

  fragment.querySelector('slot[name="status"]').replaceWith(OrderStatusBadgeView.dom(order.status));
  fragment.querySelector('slot[name="actions"]').replaceWith(V.createActionsFragment(order.actions));
  fragment.querySelector("[data-order-lines]").append(...order.lines.map(V.createLineFragment));

  return fragment;
};

/**
 * @param {NonNullable<ReturnType<typeof M.getViewData>["order"]>["actions"]} actions
 * @returns {DocumentFragment} « Commander à nouveau », et « Voir mon panier » après un ajout.
 */
V.createActionsFragment = function (actions) {
  let fragment = htmlToFragment(genericRenderer(templateActions, actions));

  // Un template n'a pas de condition : le lien et l'état du bouton se règlent ici.
  if (!actions.hasAdded) {
    fragment.querySelector("[data-cart-link]").remove();
  }

  let button = fragment.querySelector('[data-action="reorder"]');
  button.disabled = actions.isReordering;
  button.addEventListener("click", C.handler_reorder);

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getLine>} line
 * @returns {DocumentFragment} Un article de la commande.
 */
V.createLineFragment = function (line) {
  let fragment = htmlToFragment(genericRenderer(templateLine, line));

  fragment.querySelector('slot[name="visual"]').replaceWith(V.createVisualFragment(line.imageUrl));

  let stock = fragment.querySelector('slot[name="stock"]');
  if (line.availability === null) {
    stock.remove();
  } else if (line.availability === "removed") {
    stock.replaceWith(htmlToFragment(templateUnavailable));
  } else {
    stock.replaceWith(StockBadgeView.dom(line.availability));
  }

  return fragment;
};

/**
 * @param {?string} imageUrl - Adresse de la photo, ou null.
 * @returns {DocumentFragment} La photo, ou « Photo à venir ».
 */
V.createVisualFragment = function (imageUrl) {
  if (imageUrl === null) {
    return htmlToFragment(templatePlaceholder);
  }

  let fragment = htmlToFragment(genericRenderer(templateImage, { imageUrl }));
  let image = fragment.querySelector("img");

  // Fichier absent ou illisible : remplaçant plutôt qu'une image cassée.
  image.addEventListener("error", () => {
    image.parentElement.replaceWith(V.createVisualFragment(null));
  });

  return fragment;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @param {{id: string}} params
 * @returns {Promise<DocumentFragment>}
 */
export function AccountOrderPage(params) {
  return C.init(params);
}
