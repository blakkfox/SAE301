import { AdminData } from "../../data/admin.js";
import { formatPrice } from "../../lib/format.js";
import {
  ORDER_STATUS_WORDS,
  formatCustomerShort,
  formatEventTime,
  formatOrderNumber,
  formatPhone,
  formatPickupLong,
  formatPickupShort,
} from "../../lib/order.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { MessageView } from "../../ui/message/index.js";
import { OrderStatusBadgeView } from "../../ui/order-status-badge/index.js";
import { OrderStatusFilterView } from "../../ui/order-status-filter/index.js";
import { PaginationView } from "../../ui/pagination/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateBulkBar from "./bulk-bar.html?raw";
import templateTable from "./table.html?raw";
import templateSortHeader from "./sort-header.html?raw";
import templateRow from "./row.html?raw";
import templateEmpty from "./empty.html?raw";
import templateLoading from "./loading.html?raw";
import templateDetail from "./detail.html?raw";
import templateDetailLine from "./detail-line.html?raw";
import templateDetailEmpty from "./detail-empty.html?raw";
import templateDetailError from "./detail-error.html?raw";
import templateCancelConfirm from "./cancel-confirm.html?raw";
import templateLogin from "./login.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Gestion des commandes » — US PIL-b (écran Figma n° 11), route
 * /admin/commandes.
 *
 * Filtres par statut, recherche par numéro ou client, tri par colonne et
 * pagination (faits par le serveur). Les commandes cochées passent en lot à
 * « disponible » ou « retirée » ; la commande ouverte se détaille à droite,
 * avec l'action suivante du cycle, l'annulation (confirmée, le stock est
 * recrédité par le serveur) et le journal de ses statuts.
 *
 * Le serveur décide de tout : accès (401, 403), passages autorisés (en cours
 * → disponible → retirée), annulation impossible d'une commande retirée. La
 * page n'affiche que ce qu'il répond.
 *
 * Découpage MVC strict :
 *   M — liste, sélection, détail, état de la page, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Pastilles de filtre, dans l'ordre de la maquette. countKey : clé de counts.
const FILTERS = [
  { status: null, label: "Toutes", countKey: "all" },
  { status: "en_cours", label: "En cours", countKey: "en_cours" },
  { status: "disponible", label: "Disponibles", countKey: "disponible" },
  { status: "retiree", label: "Retirées", countKey: "retiree" },
  { status: "annulee", label: "Annulées", countKey: "annulee" },
];

// Colonnes triables : premier clic, puis second clic sur la même colonne
// (clés de ORDER_SORTS dans AdminController).
const SORT_COLUMNS = [
  { column: "customer", label: "Client", first: "customer_asc", second: "customer_desc" },
  { column: "pickup", label: "Retrait", first: "pickup_desc", second: "pickup_asc" },
  { column: "total", label: "Total", first: "total_desc", second: "total_asc" },
  { column: "status", label: "Statut", first: "status_asc", second: "status_desc" },
];

// Action suivante du cycle, selon le statut de la commande ouverte.
const NEXT_STEPS = {
  en_cours: { status: "disponible", label: "Marquer comme disponible" },
  disponible: { status: "retiree", label: "Marquer comme retirée" },
};

// Ligne du journal, selon le statut atteint.
const EVENT_LABELS = {
  en_cours: "commande créée (en cours)",
  disponible: "passée à « disponible »",
  retiree: "retirée",
  annulee: "annulée",
};

const SERVER_DOWN = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  list: null, // réponse de GET /api/admin/orders, ou null
  query: null, // { status, search, sort, page } demandés à l'API
  listRequest: 0, // numéro de la dernière demande de liste : les réponses plus anciennes sont ignorées
  state: "list", // "list", "login" ou "error"
  isLoading: false, // la liste est en cours de rechargement
  errorMessage: "", // message de l'état "error"
  notice: null, // { type, texte } au-dessus du contenu, ou null
  selectedIds: [], // commandes cochées, de la page affichée
  detailId: null, // commande ouverte, ou null
  detail: null, // réponse de GET /api/admin/order (order), ou null
  detailError: "", // message si le détail n'a pas pu être chargé
  isDetailLoading: false, // le détail est en cours de chargement
  isConfirmingCancel: false, // la confirmation d'annulation est affichée
  isBusy: false, // un changement de statut ou une annulation est en cours
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.list = null;
  M.query = { status: null, search: "", sort: null, page: 1 };
  M.state = "list";
  M.isLoading = false;
  M.errorMessage = "";
  M.notice = null;
  M.selectedIds = [];
  M.detailId = null;
  M.detail = null;
  M.detailError = "";
  M.isDetailLoading = false;
  M.isConfirmingCancel = false;
  M.isBusy = false;
};

/**
 * Refus du serveur (401, 403) : la page affiche la connexion.
 *
 * @param {ErreurApi} error
 * @returns {boolean} true si l'erreur était un refus d'accès.
 */
M.handleAccessError = function (error) {
  if (error.statut !== 401 && error.statut !== 403) return false;

  M.state = "login";
  M.notice =
    error.statut === 403
      ? { type: "erreur", texte: "Vous êtes connecté avec un compte client. Connectez-vous avec un compte administrateur." }
      : null;
  return true;
};

/**
 * Charge la page de commandes demandée par M.query. Le serveur rappelle les
 * réglages qu'il a appliqués : M.query les reprend. Les cases cochées qui ne
 * sont plus affichées sont décochées.
 *
 * @returns {Promise<void>}
 */
M.loadList = async function () {
  let request = ++M.listRequest;
  M.isLoading = true;

  try {
    let list = await AdminData.fetchOrders(M.query);
    if (request !== M.listRequest) return;

    M.list = list;
    M.query = { status: list.status, search: list.search, sort: list.sort, page: list.page };
    M.state = "list";

    let shownIds = list.orders.map((order) => order.id);
    M.selectedIds = M.selectedIds.filter((id) => shownIds.includes(id));
  } catch (error) {
    if (request !== M.listRequest || M.handleAccessError(error)) return;

    let message = error.statut === undefined ? SERVER_DOWN : `Impossible de charger les commandes : ${error.message}`;
    if (M.list === null) {
      M.state = "error";
      M.errorMessage = message;
    } else {
      M.notice = { type: "erreur", texte: message };
    }
  } finally {
    if (request === M.listRequest) M.isLoading = false;
  }
};

/**
 * Charge le détail de la commande ouverte.
 *
 * @returns {Promise<void>}
 */
M.loadDetail = async function () {
  let id = M.detailId;
  M.isDetailLoading = true;
  M.detailError = "";

  try {
    let response = await AdminData.fetchOrder(id);
    if (id !== M.detailId) return;
    M.detail = response.order;
  } catch (error) {
    if (id !== M.detailId || M.handleAccessError(error)) return;

    M.detail = null;
    M.detailError =
      error.statut === 404
        ? "Cette commande n’existe plus."
        : error.statut === undefined
          ? SERVER_DOWN
          : `Impossible de charger la commande : ${error.message}`;
  } finally {
    if (id === M.detailId) M.isDetailLoading = false;
  }
};

/**
 * Recharge la liste (compteurs compris) et le détail ouvert, après une action.
 *
 * @returns {Promise<void>}
 */
M.refresh = async function () {
  if (M.state !== "list") return;
  await Promise.all([M.loadList(), M.detailId === null ? Promise.resolve() : M.loadDetail()]);
};

/**
 * @param {?string} status - Statut à afficher, ou null pour toutes.
 */
M.setStatus = function (status) {
  M.query.status = status;
  M.query.page = 1;
  M.selectedIds = [];
  M.isLoading = true;
  M.notice = null;
};

/**
 * @param {string} search - Numéro ou nom du client saisi.
 */
M.setSearch = function (search) {
  M.query.search = search.trim();
  M.query.page = 1;
  M.selectedIds = [];
  M.isLoading = true;
  M.notice = null;
};

/**
 * Premier clic sur une colonne : son tri par défaut ; clic suivant : le sens inverse.
 *
 * @param {string} column - « customer », « pickup », « total » ou « status ».
 */
M.toggleSort = function (column) {
  let sort = SORT_COLUMNS.find((item) => item.column === column);
  if (sort === undefined) return;

  M.query.sort = M.query.sort === sort.first ? sort.second : sort.first;
  M.query.page = 1;
  M.isLoading = true;
  M.notice = null;
};

/**
 * @param {number} page
 */
M.setPage = function (page) {
  M.query.page = page;
  M.selectedIds = [];
  M.isLoading = true;
  M.notice = null;
};

/**
 * @param {number} id
 * @param {boolean} isChecked
 */
M.toggleOrder = function (id, isChecked) {
  M.selectedIds = M.selectedIds.filter((selectedId) => selectedId !== id);
  if (isChecked) M.selectedIds.push(id);
};

/**
 * @param {boolean} isChecked - Cocher ou décocher toutes les commandes affichées.
 */
M.toggleAll = function (isChecked) {
  M.selectedIds = isChecked ? M.list.orders.map((order) => order.id) : [];
};

/**
 * Ouvre une commande : son détail sera chargé par M.loadDetail.
 *
 * @param {number} id
 */
M.openDetail = function (id) {
  M.detailId = id;
  M.detail = null;
  M.detailError = "";
  M.isDetailLoading = true;
  M.isConfirmingCancel = false;
};

/**
 * Début d'une action (changement de statut, annulation) : une seule à la fois.
 *
 * @returns {boolean} false si une action est déjà en cours.
 */
M.startBusy = function () {
  if (M.isBusy) return false;

  M.isBusy = true;
  M.notice = null;
  return true;
};

/**
 * @param {number[]} ids
 * @returns {string} « CMD-0142, CMD-0141 ».
 */
M.formatNumbers = function (ids) {
  return ids.map(formatOrderNumber).join(", ");
};

/**
 * @param {{status: string, updated: number[], skipped: number[]}} result - Réponse de l'API.
 * @returns {{type: string, texte: string}} Le message à afficher.
 */
M.getStatusNotice = function (result) {
  let target = `« ${ORDER_STATUS_WORDS[result.status]} »`;
  let skipped =
    result.skipped.length === 0
      ? ""
      : ` ${M.formatNumbers(result.skipped)} : statut inchangé, il ne permet pas de passer à ${target}.`;

  if (result.updated.length === 0) {
    return { type: "erreur", texte: `Aucune commande modifiée.${skipped}` };
  }

  let updated =
    result.updated.length === 1
      ? `La commande ${formatOrderNumber(result.updated[0])} est passée à ${target}.`
      : `${result.updated.length} commandes passées à ${target}.`;
  return { type: "succes", texte: updated + skipped };
};

/**
 * Erreur d'une action : connexion si l'accès est refusé, message sinon.
 *
 * @param {ErreurApi} error
 * @param {string} prefix - Par exemple « Le statut n’a pas pu être changé ».
 */
M.handleActionError = function (error, prefix) {
  if (M.handleAccessError(error)) return;
  M.notice = { type: "erreur", texte: error.statut === undefined ? SERVER_DOWN : `${prefix} : ${error.message}` };
};

/**
 * Fait passer des commandes à un statut, puis recharge liste et détail.
 * À appeler après M.startBusy.
 *
 * @param {number[]} ids
 * @param {"disponible"|"retiree"} status
 * @returns {Promise<void>}
 */
M.changeStatus = async function (ids, status) {
  try {
    let result = await AdminData.updateOrderStatus(ids, status);
    M.notice = M.getStatusNotice(result);
    M.selectedIds = M.selectedIds.filter((id) => !result.updated.includes(id));
  } catch (error) {
    M.handleActionError(error, "Le statut n’a pas pu être changé");
  }

  await M.refresh();
  M.isBusy = false;
};

/**
 * Passages en lot des commandes cochées. À appeler après M.startBusy.
 *
 * @param {"disponible"|"retiree"} status
 * @returns {Promise<void>}
 */
M.changeSelectedStatus = async function (status) {
  await M.changeStatus([...M.selectedIds], status);
};

/**
 * Action suivante du cycle pour la commande ouverte. À appeler après M.startBusy.
 *
 * @returns {Promise<void>}
 */
M.advanceDetail = async function () {
  let next = M.detail === null ? undefined : NEXT_STEPS[M.detail.status];

  if (next === undefined) {
    M.isBusy = false;
    return;
  }
  await M.changeStatus([M.detail.id], next.status);
};

/**
 * @returns {boolean} La commande ouverte peut être annulée (ni retirée, ni annulée).
 */
M.canCancel = function () {
  return M.detail !== null && NEXT_STEPS[M.detail.status] !== undefined;
};

/**
 * Affiche la confirmation de l'annulation.
 */
M.askCancel = function () {
  M.isConfirmingCancel = M.canCancel();
};

/**
 * Referme la confirmation de l'annulation.
 */
M.closeCancel = function () {
  M.isConfirmingCancel = false;
};

/**
 * @returns {number} Nombre d'articles de la commande ouverte que le serveur
 *   remettra en stock (les produits supprimés depuis n'ont plus de stock).
 */
M.countRestockable = function () {
  return M.detail.lines
    .filter((line) => line.variantId !== null)
    .reduce((count, line) => count + line.quantity, 0);
};

/**
 * Annule la commande ouverte (le serveur recrédite le stock), puis recharge
 * la liste. À appeler après M.startBusy.
 *
 * @returns {Promise<void>}
 */
M.confirmCancel = async function () {
  let id = M.detail.id;
  let restocked = M.countRestockable();

  try {
    let response = await AdminData.cancelOrder(id);
    M.detail = response.order;
    M.notice = {
      type: "succes",
      texte: `La commande ${formatOrderNumber(id)} est annulée. ${M.formatRestocked(restocked)}`,
    };
  } catch (error) {
    M.handleActionError(error, "La commande n’a pas pu être annulée");
  }

  M.isConfirmingCancel = false;
  await M.refresh();
  M.isBusy = false;
};

/**
 * @param {number} count - Articles remis en stock.
 * @returns {string} « 4 articles remis en stock. », « Aucun article à remettre en stock. »
 */
M.formatRestocked = function (count) {
  if (count === 0) return "Aucun article à remettre en stock.";
  return `${M.formatCount(count, "article remis", "articles remis")} en stock.`;
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
 * @returns {Array<{status: ?string, label: string, count: number, countLabel: string, isActive: boolean}>}
 */
M.getFilters = function () {
  return FILTERS.map((filter) => {
    let count = M.list.counts[filter.countKey];
    return {
      status: filter.status,
      label: filter.label,
      count,
      countLabel: M.formatCount(count, "commande", "commandes"),
      isActive: filter.status === M.query.status,
    };
  });
};

/**
 * @returns {Array<{column: string, label: string, arrow: string, ariaSort: ?string}>}
 *   Les en-têtes triables ; ariaSort n'est renseigné que pour le tri appliqué.
 */
M.getSortHeaders = function () {
  return SORT_COLUMNS.map((sort) => {
    let isActive = M.query.sort === sort.first || M.query.sort === sort.second;
    let isAscending = M.query.sort.endsWith("_asc");
    return {
      column: sort.column,
      label: sort.label,
      arrow: isActive ? (isAscending ? "↑" : "↓") : "▾",
      ariaSort: isActive ? (isAscending ? "ascending" : "descending") : null,
    };
  });
};

/**
 * @returns {string} Message de la liste vide, selon les filtres appliqués.
 */
M.getEmptyMessage = function () {
  if (M.query.search !== "") return `Aucune commande ne correspond à « ${M.query.search} ».`;
  if (M.query.status !== null) return `Aucune commande « ${ORDER_STATUS_WORDS[M.query.status]} ».`;
  return "Aucune commande pour le moment.";
};

/**
 * @returns {Object} Liste, sélection, tri et pagination, prêts à afficher.
 */
M.getListData = function () {
  let list = M.list;
  let selectedCount = M.selectedIds.length;

  return {
    isLoading: M.isLoading,
    rows: list.orders.map((order) => ({
      id: order.id,
      number: formatOrderNumber(order.id),
      customer: formatCustomerShort(order.customer),
      pickup: formatPickupShort(order.pickupStart, order.dayOffset),
      total: formatPrice(order.total),
      status: order.status,
      isChecked: M.selectedIds.includes(order.id),
      isOpen: order.id === M.detailId,
    })),
    emptyMessage: M.getEmptyMessage(),
    caption: `${M.formatCount(list.total, "commande", "commandes")}, page ${list.page} sur ${list.pageCount}`,
    selection: {
      label: M.isBusy
        ? "Mise à jour…"
        : selectedCount === 0
          ? "Aucune commande sélectionnée"
          : `${M.formatCount(selectedCount, "commande sélectionnée", "commandes sélectionnées")}`,
      canAct: selectedCount > 0 && !M.isBusy,
    },
    allChecked: list.orders.length > 0 && selectedCount === list.orders.length,
    someChecked: selectedCount > 0 && selectedCount < list.orders.length,
    sortHeaders: M.getSortHeaders(),
    pagination: {
      page: list.page,
      pagesTotal: list.pageCount,
      pages: Array.from({ length: list.pageCount }, (_, index) => index + 1),
    },
  };
};

/**
 * @returns {string} « Journal : 13/10 14:02 commande créée (en cours) · … ».
 */
M.formatJournal = function () {
  let events = M.detail.events;

  // Commande antérieure au journal des statuts : seule sa date est connue.
  if (events.length === 0) {
    return `Journal : ${formatEventTime(M.detail.createdAt)} ${EVENT_LABELS.en_cours}`;
  }

  let entries = events.map((event) => {
    let author = event.status === "en_cours" ? "" : ` par ${event.admin === null ? "un administrateur" : `${event.admin.firstName} (admin)`}`;
    return `${formatEventTime(event.createdAt)} ${EVENT_LABELS[event.status]}${author}`;
  });
  return `Journal : ${entries.join(" · ")}`;
};

/**
 * @returns {Object} Le détail de la commande ouverte, selon son état
 *   ("empty", "error" ou "ready"), prêt à afficher.
 */
M.getDetailData = function () {
  if (M.detailId === null) {
    return { state: "empty", message: "Choisissez une commande dans la liste pour afficher son détail." };
  }
  if (M.isDetailLoading && M.detail === null) {
    return { state: "empty", message: `Chargement de la commande ${formatOrderNumber(M.detailId)}…` };
  }
  if (M.detail === null) {
    return { state: "error", number: formatOrderNumber(M.detailId), message: M.detailError };
  }

  let order = M.detail;
  let next = NEXT_STEPS[order.status] ?? null;
  let restockable = M.countRestockable();

  return {
    state: "ready",
    number: formatOrderNumber(order.id),
    status: order.status,
    customerLine: [
      formatCustomerShort(order.customer),
      formatPhone(order.customer.phone),
      `retrait ${formatPickupLong(order.pickupStart, order.pickupEnd, order.dayOffset)}`,
      order.dealership.shortName,
    ].join(" · "),
    lines: order.lines.map((line) => ({
      // « Unique » : produit sans déclinaison, le nom suffit.
      label: `${line.name}${line.label === "Unique" ? "" : ` · ${line.label}`} × ${line.quantity}`,
      // Options à préparer (OPT-a), au supplément payé ; unitPrice le comprend déjà.
      options: line.options.map((option) => `+ ${option.label} (${formatPrice(option.price)})`).join(" · "),
      price: formatPrice(line.unitPrice * line.quantity),
    })),
    total: formatPrice(order.total),
    advanceLabel: next === null ? "" : next.label,
    hasNext: next !== null,
    canCancel: M.canCancel(),
    isConfirmingCancel: M.isConfirmingCancel,
    isBusy: M.isBusy,
    restockText:
      restockable === 0
        ? "Aucun article ne sera remis en stock."
        : restockable === 1
          ? "L’article sera remis en stock."
          : `Les ${restockable} articles seront remis en stock.`,
    confirmLabel: M.isBusy ? "Annulation…" : "Confirmer l’annulation",
    journal: M.formatJournal(),
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "list"|"login"|"error", notice: ?{type: string, texte: string}, errorMessage: string,
 *   content: ?{adminLabel: string, search: string, filters: ReturnType<typeof M.getFilters>,
 *     list: ReturnType<typeof M.getListData>, detail: ReturnType<typeof M.getDetailData>}}}
 */
M.getViewData = function () {
  return {
    state: M.state,
    notice: M.notice,
    errorMessage: M.errorMessage,
    content:
      M.state !== "list" || M.list === null
        ? null
        : {
            adminLabel: `${M.list.admin.firstName} (admin) · Lyon Centre`,
            search: M.query.search,
            filters: M.getFilters(),
            list: M.getListData(),
            detail: M.getDetailData(),
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
  await M.loadList();
  return V.init(M.getViewData());
};

/**
 * Clic sur une pastille de filtre.
 *
 * @param {?string} status
 * @returns {Promise<void>}
 */
C.handler_filter = async function (status) {
  M.setStatus(status);
  V.render(M.getViewData());
  await M.loadList();
  V.render(M.getViewData());
};

/**
 * Envoi de la recherche.
 *
 * @param {string} search
 * @returns {Promise<void>}
 */
C.handler_search = async function (search) {
  M.setSearch(search);
  V.render(M.getViewData());
  await M.loadList();
  V.render(M.getViewData());
};

/**
 * Clic sur un en-tête triable.
 *
 * @param {string} column
 * @returns {Promise<void>}
 */
C.handler_sort = async function (column) {
  M.toggleSort(column);
  V.render(M.getViewData());
  await M.loadList();
  V.render(M.getViewData());
};

/**
 * Clic sur un numéro de page.
 *
 * @param {number} page
 * @returns {Promise<void>}
 */
C.handler_page = async function (page) {
  M.setPage(page);
  V.render(M.getViewData());
  await M.loadList();
  V.render(M.getViewData());
  V.focusListTitle();
};

/**
 * Case d'une commande cochée ou décochée.
 *
 * @param {number} id
 * @param {boolean} isChecked
 */
C.handler_toggleOrder = function (id, isChecked) {
  M.toggleOrder(id, isChecked);
  V.render(M.getViewData());
};

/**
 * Case « tout sélectionner » cochée ou décochée.
 *
 * @param {boolean} isChecked
 */
C.handler_toggleAll = function (isChecked) {
  M.toggleAll(isChecked);
  V.render(M.getViewData());
};

/**
 * « Passer à « disponible » » ou « Passer à « retirée » » sur la sélection.
 *
 * @param {"disponible"|"retiree"} status
 * @returns {Promise<void>}
 */
C.handler_bulkStatus = async function (status) {
  if (!M.startBusy()) return;
  V.render(M.getViewData());

  await M.changeSelectedStatus(status);

  V.render(M.getViewData());
  V.focusTitle();
};

/**
 * Clic sur le numéro d'une commande : affiche son détail.
 *
 * @param {number} id
 * @returns {Promise<void>}
 */
C.handler_open = async function (id) {
  M.openDetail(id);
  V.render(M.getViewData());
  await M.loadDetail();
  V.render(M.getViewData());
  V.focusDetailTitle();
};

/**
 * « Réessayer » dans le détail.
 *
 * @returns {Promise<void>}
 */
C.handler_retryDetail = async function () {
  await M.loadDetail();
  V.render(M.getViewData());
  V.focusDetailTitle();
};

/**
 * « Marquer comme disponible » ou « Marquer comme retirée » dans le détail.
 *
 * @returns {Promise<void>}
 */
C.handler_advance = async function () {
  if (!M.startBusy()) return;
  V.render(M.getViewData());

  await M.advanceDetail();

  V.render(M.getViewData());
  V.focusDetailTitle();
};

/**
 * « Annuler la commande » : demande confirmation.
 */
C.handler_askCancel = function () {
  M.askCancel();
  V.render(M.getViewData());
  V.focusConfirm();
};

/**
 * « Retour » dans la confirmation.
 */
C.handler_backCancel = function () {
  M.closeCancel();
  V.render(M.getViewData());
  V.focusKey("ask-cancel");
};

/**
 * « Confirmer l'annulation ».
 *
 * @returns {Promise<void>}
 */
C.handler_confirmCancel = async function () {
  if (!M.startBusy()) return;
  V.render(M.getViewData());

  await M.confirmCancel();

  V.render(M.getViewData());
  V.focusDetailTitle();
};

/**
 * « Réessayer » (état "error").
 *
 * @returns {Promise<void>}
 */
C.handler_retry = async function () {
  await M.loadList();
  V.render(M.getViewData());
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  content: null, // contenu affiché : gestion des commandes, connexion ou erreur
  notice: null, // conteneur des messages
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let page = htmlToFragment(template);

  V.notice = page.querySelector("[data-orders-notice]");
  V.notice.replaceChildren(MessageView.dom(data.notice));

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit le contenu et les messages à partir de l'état.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.render = function (data) {
  V.notice.replaceChildren(MessageView.dom(data.notice));
  V.content = replaceKeepingFocus(V.content, V.createContentFragment(data));
};

/**
 * Donne le focus au titre de la page (après une action en lot, dont les
 * boutons peuvent être devenus inactifs).
 */
V.focusTitle = function () {
  V.content.querySelector("h1")?.focus();
};

/**
 * Donne le focus au titre de la liste (après un changement de page).
 */
V.focusListTitle = function () {
  V.content.querySelector("#orders-list-title")?.focus();
};

/**
 * Donne le focus au titre du détail : sur mobile, il est sous la liste.
 */
V.focusDetailTitle = function () {
  V.content.querySelector("#order-detail-title")?.focus();
};

/**
 * Donne le focus au titre de la confirmation d'annulation.
 */
V.focusConfirm = function () {
  V.content.querySelector("#cancel-confirm-title")?.focus();
};

/**
 * @param {string} key - Valeur de data-focus-key de l'élément à focaliser.
 */
V.focusKey = function (key) {
  V.content.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
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

  return V.createOrdersFragment(data.content);
};

/**
 * @param {NonNullable<ReturnType<typeof M.getViewData>["content"]>} content
 * @returns {DocumentFragment} Filtres, recherche, liste et détail.
 */
V.createOrdersFragment = function (content) {
  let fragment = htmlToFragment(
    genericRenderer(templateContent, { adminLabel: content.adminLabel, search: content.search }),
  );

  fragment
    .querySelector('slot[name="filters"]')
    .replaceWith(OrderStatusFilterView.dom(content.filters, { onChange: C.handler_filter }));

  let form = fragment.querySelector("[data-search]");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    C.handler_search(form.elements.q.value);
  });

  fragment.querySelector('slot[name="list"]').replaceWith(V.createListFragment(content.list));
  fragment.querySelector('slot[name="detail"]').replaceWith(V.createDetailFragment(content.detail));

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getListData>} list
 * @returns {DocumentFragment} Chargement, actions groupées, tableau (ou liste
 *   vide) et pagination.
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

  fragment.append(V.createBulkBarFragment(list.selection), V.createTableFragment(list));
  fragment.append(PaginationView.dom(list.pagination, { surPage: C.handler_page }));
  return fragment;
};

/**
 * @param {ReturnType<typeof M.getListData>["selection"]} selection
 * @returns {DocumentFragment} La barre des actions groupées.
 */
V.createBulkBarFragment = function (selection) {
  let fragment = htmlToFragment(genericRenderer(templateBulkBar, { selectionLabel: selection.label }));
  let buttons = fragment.querySelectorAll('[data-action="bulk"]');

  buttons[0].disabled = !selection.canAct;
  buttons[1].disabled = !selection.canAct;

  fragment.firstElementChild.addEventListener("click", (ev) => {
    let button = ev.target.closest('[data-action="bulk"]');
    if (button === null || button.disabled) return;
    C.handler_bulkStatus(button.dataset.status);
  });

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getListData>} list
 * @returns {DocumentFragment} Le tableau des commandes.
 */
V.createTableFragment = function (list) {
  let fragment = htmlToFragment(genericRenderer(templateTable, { caption: list.caption }));

  for (const header of list.sortHeaders) {
    fragment.querySelector(`slot[name="sort-${header.column}"]`).replaceWith(V.createSortHeaderFragment(header));
  }

  fragment.querySelector("[data-order-rows]").append(...list.rows.map(V.createRowFragment));

  let toggleAll = fragment.querySelector('[data-action="toggle-all"]');
  toggleAll.checked = list.allChecked;
  toggleAll.indeterminate = list.someChecked;

  // Délégation : un écouteur pour les cases, un pour les boutons.
  let table = fragment.querySelector("table");
  table.addEventListener("change", (ev) => {
    let box = ev.target.closest("input[data-action]");
    if (box === null) return;
    if (box.dataset.action === "toggle-all") {
      C.handler_toggleAll(box.checked);
    } else {
      C.handler_toggleOrder(Number(box.dataset.id), box.checked);
    }
  });
  table.addEventListener("click", (ev) => {
    let button = ev.target.closest("button[data-action]");
    if (button === null) return;
    if (button.dataset.action === "sort") {
      C.handler_sort(button.dataset.column);
    } else {
      C.handler_open(Number(button.dataset.id));
    }
  });

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getSortHeaders>[number]} header
 * @returns {DocumentFragment} Un en-tête triable.
 */
V.createSortHeaderFragment = function (header) {
  let fragment = htmlToFragment(genericRenderer(templateSortHeader, header));
  if (header.ariaSort !== null) {
    fragment.querySelector("th").setAttribute("aria-sort", header.ariaSort);
  }
  return fragment;
};

/**
 * @param {ReturnType<typeof M.getListData>["rows"][number]} row
 * @returns {DocumentFragment} Une ligne du tableau.
 */
V.createRowFragment = function (row) {
  let fragment = htmlToFragment(genericRenderer(templateRow, row));
  let tr = fragment.querySelector("tr");

  tr.dataset.checked = String(row.isChecked);
  if (row.isOpen) tr.setAttribute("aria-current", "true");
  fragment.querySelector('[data-action="toggle"]').checked = row.isChecked;
  fragment.querySelector('slot[name="status"]').replaceWith(OrderStatusBadgeView.dom(row.status));

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getDetailData>} detail
 * @returns {DocumentFragment} Le détail de la commande ouverte, ou son état.
 */
V.createDetailFragment = function (detail) {
  if (detail.state === "empty") {
    return htmlToFragment(genericRenderer(templateDetailEmpty, { message: detail.message }));
  }

  if (detail.state === "error") {
    let fragment = htmlToFragment(genericRenderer(templateDetailError, detail));
    fragment.querySelector('[data-action="retry-detail"]').addEventListener("click", C.handler_retryDetail);
    return fragment;
  }

  let fragment = htmlToFragment(genericRenderer(templateDetail, detail));
  let aside = fragment.querySelector("aside");

  aside.setAttribute("aria-busy", String(detail.isBusy));
  fragment.querySelector('slot[name="status"]').replaceWith(OrderStatusBadgeView.dom(detail.status));
  fragment.querySelector("[data-detail-lines]").append(
    ...detail.lines.map((line) => htmlToFragment(genericRenderer(templateDetailLine, line))),
  );

  // Un template n'a pas de condition : les boutons se règlent ici.
  let advance = fragment.querySelector('[data-action="advance"]');
  let askCancel = fragment.querySelector('[data-action="ask-cancel"]');
  advance.hidden = !detail.hasNext;
  advance.disabled = detail.isBusy;
  askCancel.hidden = !detail.canCancel || detail.isConfirmingCancel;
  askCancel.disabled = detail.isBusy;

  let confirmSlot = fragment.querySelector('slot[name="confirm"]');
  if (detail.isConfirmingCancel) {
    let confirm = htmlToFragment(genericRenderer(templateCancelConfirm, detail));
    confirm.querySelector('[data-action="confirm-cancel"]').disabled = detail.isBusy;
    confirmSlot.replaceWith(confirm);
  } else {
    confirmSlot.remove();
  }

  // Délégation : un seul écouteur pour les boutons du détail.
  aside.addEventListener("click", (ev) => {
    let button = ev.target.closest("button[data-action]");
    if (button === null || button.disabled) return;
    if (button.dataset.action === "advance") C.handler_advance();
    if (button.dataset.action === "ask-cancel") C.handler_askCancel();
    if (button.dataset.action === "confirm-cancel") C.handler_confirmCancel();
    if (button.dataset.action === "back-cancel") C.handler_backCancel();
  });

  return fragment;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function AdminOrdersPage() {
  return C.init();
}
