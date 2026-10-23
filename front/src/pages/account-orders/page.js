import { AuthData } from "../../data/auth.js";
import { OrderData } from "../../data/order.js";
import { formatPrice } from "../../lib/format.js";
import {
  ORDER_STATUS_WORDS,
  formatEventTime,
  formatOrderDate,
  formatOrderNumber,
  formatPickupLong,
} from "../../lib/order.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { AccountMenuView } from "../../ui/account-menu/index.js";
import { MessageView } from "../../ui/message/index.js";
import { OrderStatusBadgeView } from "../../ui/order-status-badge/index.js";
import { OrderStatusFilterView } from "../../ui/order-status-filter/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templatePeriod from "./period.html?raw";
import templateLoading from "./loading.html?raw";
import templateTable from "./table.html?raw";
import templateRow from "./row.html?raw";
import templateDetail from "./detail.html?raw";
import templateDetailLine from "./detail-line.html?raw";
import templateDetailEvent from "./detail-event.html?raw";
import templateEmpty from "./empty.html?raw";
import templateLogin from "./login.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Mes commandes » — US SUI-c (écran Figma n° 13), route /compte/commandes.
 *
 * L'historique du compte connecté : numéro, date, articles, total et statut
 * de chaque commande, des plus récentes aux plus anciennes. Les pastilles
 * filtrent par statut, le menu « Période » borne l'historique (3, 6, 12
 * derniers mois ou tout). « Voir le détail » déplie la commande : ses
 * articles, son retrait et le suivi de ses statuts, lu dans le journal tenu
 * par le back-office (US PIL-b).
 *
 * La période est appliquée par le serveur, qui ne renvoie que les commandes
 * du compte en session. Le filtre par statut, lui, est fait ici : les
 * commandes de la période sont déjà toutes chargées, et les pastilles
 * affichent leur nombre par statut.
 *
 * Découpage MVC strict :
 *   M — commandes, filtres, détails dépliés, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Pastilles de filtre, dans l'ordre et avec les libellés de la maquette.
const FILTERS = [
  { status: null, label: "Toutes" },
  { status: "en_cours", label: "En cours" },
  { status: "disponible", label: "Disponible" },
  { status: "retiree", label: "Retirée" },
  { status: "annulee", label: "Annulée" },
];

// Période par défaut (maquette : « 6 derniers mois ») ; voir period.html.
const DEFAULT_PERIOD = "6";

// Étapes du suivi, selon le statut atteint (journal order_event).
const EVENT_LABELS = {
  en_cours: "Commande passée, en préparation",
  disponible: "Disponible au retrait en concession",
  retiree: "Retirée en concession",
  annulee: "Commande annulée",
};

// Libellé du total, selon le statut : le paiement se fait au retrait.
const TOTAL_LABELS = {
  en_cours: "Total à régler sur place",
  disponible: "Total à régler sur place",
  retiree: "Total réglé",
  annulee: "Total (commande annulée)",
};

const SERVER_DOWN = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  orders: null, // commandes de la période (réponse de GET /api/orders), ou null
  period: DEFAULT_PERIOD, // période demandée : « 3 », « 6 », « 12 » ou « all »
  status: null, // statut affiché, ou null pour toutes
  openIds: [], // commandes dont le détail est déplié
  request: 0, // numéro de la dernière demande : les réponses plus anciennes sont ignorées
  state: "list", // "list", "login" ou "error"
  isLoading: false, // l'historique est en cours de chargement
  isLoggingOut: false, // la déconnexion est en cours
  errorMessage: "", // message de l'état "error"
  notice: null, // { type, texte } au-dessus du contenu, ou null
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.orders = null;
  M.period = DEFAULT_PERIOD;
  M.status = null;
  M.openIds = [];
  M.state = "list";
  M.isLoading = false;
  M.isLoggingOut = false;
  M.errorMessage = "";
  M.notice = null;
};

/**
 * Charge les commandes de la période demandée. Le serveur rappelle la
 * période qu'il a appliquée : M.period la reprend. Les détails dépliés des
 * commandes qui ne sont plus affichées sont refermés.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  let request = ++M.request;
  M.isLoading = true;

  try {
    let response = await OrderData.fetchHistory(M.period);
    if (request !== M.request) return;

    M.orders = response.orders;
    M.period = response.period;
    M.state = "list";

    let shownIds = response.orders.map((order) => order.id);
    M.openIds = M.openIds.filter((id) => shownIds.includes(id));
  } catch (error) {
    if (request !== M.request) return;

    if (error.statut === 401) {
      M.state = "login";
      M.orders = null;
      return;
    }

    let message = error.statut === undefined ? SERVER_DOWN : `Impossible de charger vos commandes : ${error.message}`;
    if (M.orders === null) {
      M.state = "error";
      M.errorMessage = message;
    } else {
      M.notice = { type: "erreur", texte: message };
    }
  } finally {
    if (request === M.request) M.isLoading = false;
  }
};

/**
 * @param {string} period - Nouvelle période : chargée ensuite par M.load.
 */
M.setPeriod = function (period) {
  M.period = period;
  M.isLoading = true;
  M.notice = null;
};

/**
 * @param {?string} status - Statut à afficher, ou null pour toutes.
 */
M.setStatus = function (status) {
  M.status = status;
  M.notice = null;
};

/**
 * Déplie ou replie le détail d'une commande.
 *
 * @param {number} id
 */
M.toggleDetail = function (id) {
  M.openIds = M.openIds.includes(id) ? M.openIds.filter((openId) => openId !== id) : [...M.openIds, id];
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
    M.request++; // une réponse encore attendue ne doit pas réafficher les commandes
    M.state = "login";
    M.orders = null;
    M.openIds = [];
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
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string} « 1 commande », « 4 commandes »…
 */
M.formatCount = function (count, singular, plural) {
  return `${count} ${count > 1 ? plural : singular}`;
};

/**
 * @param {{name: string, label: string, quantity: number}} line
 * @returns {string} « Blouson cuir Maine (M) », « T-shirt Capsule (L) × 2 »,
 *   « Porte-clés Rubber Wing » : la colonne Articles de la maquette.
 */
M.formatArticle = function (line) {
  // « Unique » : produit sans déclinaison, le nom suffit. « Taille M » devient « M ».
  let variant = line.label === "Unique" ? "" : ` (${line.label.replace(/^Taille /, "")})`;
  return `${line.name}${variant}${line.quantity > 1 ? ` × ${line.quantity}` : ""}`;
};

/**
 * @returns {Array<{status: ?string, label: string, count: number, countLabel: string, isActive: boolean}>}
 *   Les pastilles, avec le nombre de commandes de la période pour chaque statut.
 */
M.getFilters = function () {
  return FILTERS.map((filter) => {
    let count =
      filter.status === null ? M.orders.length : M.orders.filter((order) => order.status === filter.status).length;
    return {
      status: filter.status,
      label: filter.label,
      count,
      countLabel: M.formatCount(count, "commande", "commandes"),
      isActive: filter.status === M.status,
    };
  });
};

/**
 * @returns {string} Message de la liste vide, selon la période et le statut.
 */
M.getEmptyMessage = function () {
  let period = M.period === "all" ? "" : ` sur les ${M.period} derniers mois`;

  if (M.orders.length === 0) {
    return M.period === "all" ? "Vous n’avez pas encore passé de commande." : `Aucune commande${period}.`;
  }
  return `Aucune commande « ${ORDER_STATUS_WORDS[M.status]} »${period}.`;
};

/**
 * @param {Object} order - Une commande de l'API.
 * @returns {Array<{time: string, label: string}>} Les étapes du suivi, de la
 *   plus ancienne à la plus récente.
 */
M.getEvents = function (order) {
  // Commande antérieure au journal des statuts : seule sa date est connue.
  if (order.events.length === 0) {
    return [{ time: formatEventTime(order.createdAt), label: EVENT_LABELS.en_cours }];
  }
  return order.events.map((event) => ({ time: formatEventTime(event.createdAt), label: EVENT_LABELS[event.status] }));
};

/**
 * @param {Object} order - Une commande de l'API.
 * @returns {Object} Le détail déplié de la commande, prêt à afficher.
 */
M.getDetail = function (order) {
  let lines = order.lines.map((line) => ({
    label:
      `${line.name}${line.label === "Unique" ? "" : ` · ${line.label}`} × ${line.quantity}` +
      line.options.map((option) => ` + ${option.label}`).join(""),
    price: formatPrice(line.unitPrice * line.quantity),
  }));

  // Remise du code promo (PRO-a) : sans elle, la somme des articles ne
  // correspond pas au total payé.
  if (order.discount > 0) {
    lines = [...lines, { label: `Code promo ${order.promoCode}`, price: `−${formatPrice(order.discount)}` }];
  }

  return {
    id: order.id,
    number: formatOrderNumber(order.id),
    lines,
    totalLabel: TOTAL_LABELS[order.status],
    total: formatPrice(order.total),
    pickup: `${order.dealership.name}, ${formatPickupLong(order.pickupStart, order.pickupEnd, order.dayOffset)}`,
    events: M.getEvents(order),
  };
};

/**
 * @returns {Object} Les commandes du statut affiché, prêtes à afficher.
 */
M.getListData = function () {
  let orders = M.status === null ? M.orders : M.orders.filter((order) => order.status === M.status);

  return {
    isLoading: M.isLoading,
    emptyMessage: M.getEmptyMessage(),
    caption: `${M.formatCount(orders.length, "commande", "commandes")}, de la plus récente à la plus ancienne`,
    rows: orders.map((order) => {
      let isOpen = M.openIds.includes(order.id);
      return {
        id: order.id,
        number: formatOrderNumber(order.id),
        date: formatOrderDate(order.createdAt),
        articles: order.lines.map(M.formatArticle).join(", "),
        total: formatPrice(order.total),
        status: order.status,
        isOpen,
        toggleLabel: isOpen ? "Masquer le détail" : "Voir le détail",
        detail: M.getDetail(order),
      };
    }),
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "list"|"login"|"error", notice: ?{type: string, texte: string}, errorMessage: string,
 *   menu: {current: string, logoutLabel: string, isLoggingOut: boolean},
 *   content: ?{filters: ReturnType<typeof M.getFilters>, period: {value: string, disabled: boolean},
 *     list: ReturnType<typeof M.getListData>}}}
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
    content:
      M.state !== "list" || M.orders === null
        ? null
        : {
            filters: M.getFilters(),
            period: { value: M.period, disabled: M.isLoading },
            list: M.getListData(),
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
 * Clic sur une pastille de filtre : le filtre est fait sans appel à l'API.
 *
 * @param {?string} status
 */
C.handler_filter = function (status) {
  M.setStatus(status);
  V.render(M.getViewData());
};

/**
 * Choix d'une autre période : rechargement de l'historique.
 *
 * @param {string} period
 * @returns {Promise<void>}
 */
C.handler_period = async function (period) {
  M.setPeriod(period);
  V.render(M.getViewData());
  await M.load();
  V.render(M.getViewData());
};

/**
 * « Voir le détail » ou « Masquer le détail ».
 *
 * @param {number} id
 */
C.handler_toggleDetail = function (id) {
  M.toggleDetail(id);
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
  title: null, // titre « Mes commandes »
  menu: null, // menu « Mon compte » affiché
  notice: null, // conteneur des messages
  content: null, // contenu affiché : historique, connexion ou erreur
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let page = htmlToFragment(template);
  V.title = page.querySelector("h1");

  let menu = V.createMenuFragment(data.menu);
  V.menu = menu.firstElementChild;
  page.querySelector('slot[name="menu"]').replaceWith(menu);

  V.notice = page.querySelector("[data-orders-notice]");
  V.notice.replaceChildren(MessageView.dom(data.notice));

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit le menu, les messages et le contenu à partir de l'état.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.render = function (data) {
  V.menu = replaceKeepingFocus(V.menu, V.createMenuFragment(data.menu));
  V.notice.replaceChildren(MessageView.dom(data.notice));
  V.content = replaceKeepingFocus(V.content, V.createContentFragment(data));
};

/**
 * Donne le focus au titre de la page (après la déconnexion, dont le bouton
 * était devenu inactif).
 */
V.focusTitle = function () {
  V.title.focus();
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
 * @returns {DocumentFragment} Le contenu de l'état courant.
 */
V.createContentFragment = function (data) {
  if (data.state === "login") {
    return htmlToFragment(templateLogin);
  }

  if (data.state === "error" || data.content === null) {
    let fragment = htmlToFragment(genericRenderer(templateError, { message: data.errorMessage }));
    fragment.querySelector('[data-action="retry"]').addEventListener("click", C.handler_retry);
    return fragment;
  }

  let fragment = htmlToFragment(templateContent);
  fragment
    .querySelector('slot[name="filters"]')
    .replaceWith(OrderStatusFilterView.dom(data.content.filters, { onChange: C.handler_filter }));
  fragment.querySelector('slot[name="period"]').replaceWith(V.createPeriodFragment(data.content.period));
  fragment.querySelector('slot[name="list"]').replaceWith(V.createListFragment(data.content.list));
  return fragment;
};

/**
 * @param {{value: string, disabled: boolean}} period
 * @returns {DocumentFragment} Le choix de la période.
 */
V.createPeriodFragment = function (period) {
  let fragment = htmlToFragment(templatePeriod);
  let select = fragment.querySelector('select[name="period"]');

  // Un template n'a pas de condition : l'option choisie se règle ici.
  select.value = period.value;
  select.disabled = period.disabled;
  select.addEventListener("change", (ev) => C.handler_period(ev.target.value));

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getListData>} list
 * @returns {DocumentFragment} Chargement, puis tableau (ou liste vide).
 */
V.createListFragment = function (list) {
  let fragment = document.createDocumentFragment();

  if (list.isLoading) {
    fragment.append(htmlToFragment(templateLoading));
  }

  if (list.rows.length === 0) {
    fragment.append(htmlToFragment(genericRenderer(templateEmpty, { message: list.emptyMessage })));
    return fragment;
  }

  fragment.append(V.createTableFragment(list));
  return fragment;
};

/**
 * @param {ReturnType<typeof M.getListData>} list
 * @returns {DocumentFragment} Le tableau des commandes.
 */
V.createTableFragment = function (list) {
  let fragment = htmlToFragment(genericRenderer(templateTable, { caption: list.caption }));
  let table = fragment.querySelector("table");

  table.append(...list.rows.map(V.createRowFragment));

  // Délégation : un seul écouteur pour tous les boutons « Voir le détail ».
  table.addEventListener("click", (ev) => {
    let button = ev.target.closest('button[data-action="toggle-detail"]');
    if (button === null) return;
    C.handler_toggleDetail(Number(button.dataset.id));
  });

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getListData>["rows"][number]} row
 * @returns {DocumentFragment} Une commande : sa ligne et son détail.
 */
V.createRowFragment = function (row) {
  let fragment = htmlToFragment(genericRenderer(templateRow, row));

  fragment.querySelector('slot[name="status"]').replaceWith(OrderStatusBadgeView.dom(row.status));

  // Un template n'a pas de condition : le détail déplié se règle ici.
  fragment.querySelector('[data-action="toggle-detail"]').setAttribute("aria-expanded", String(row.isOpen));
  fragment.querySelector(`#order-detail-${row.id}`).hidden = !row.isOpen;

  if (row.isOpen) {
    fragment.querySelector('slot[name="detail"]').replaceWith(V.createDetailFragment(row.detail));
  } else {
    fragment.querySelector('slot[name="detail"]').remove();
  }

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getDetail>} detail
 * @returns {DocumentFragment} Articles, retrait et suivi d'une commande.
 */
V.createDetailFragment = function (detail) {
  let fragment = htmlToFragment(genericRenderer(templateDetail, detail));

  fragment
    .querySelector("[data-detail-lines]")
    .append(...detail.lines.map((line) => htmlToFragment(genericRenderer(templateDetailLine, line))));
  fragment
    .querySelector("[data-detail-events]")
    .append(...detail.events.map((event) => htmlToFragment(genericRenderer(templateDetailEvent, event))));

  return fragment;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function AccountOrdersPage() {
  return C.init();
}
