import { AdminData } from "../../data/admin.js";
import { formatPrice } from "../../lib/format.js";
import { getStockStatus } from "../../lib/stock.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { AdminLoginFormView } from "../../ui/admin-login-form/index.js";
import { MessageView } from "../../ui/message/index.js";
import { OrderStatusBadgeView } from "../../ui/order-status-badge/index.js";
import { StatCardView } from "../../ui/stat-card/index.js";
import template from "./template.html?raw";
import templateDashboard from "./dashboard.html?raw";
import templateOrdersTable from "./orders-table.html?raw";
import templateOrderRow from "./order-row.html?raw";
import templateOrdersEmpty from "./orders-empty.html?raw";
import templateAlerts from "./alerts.html?raw";
import templateAlertRow from "./alert-row.html?raw";
import templateAlertsEmpty from "./alerts-empty.html?raw";
import templateLogin from "./login.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Tableau de bord » — US GOF-b (écran Figma n° 10), route /admin.
 *
 * Connecté en administrateur : quatre indicateurs (produits en ligne,
 * commandes depuis l'ouverture, commandes en cours, produits épuisés), les
 * prochaines commandes à préparer et les alertes de stock. Sinon : la
 * connexion administrateur, séparée de celle des clients.
 *
 * C'est le serveur qui décide de l'accès (401 sans session, 403 pour un
 * compte client) : la page ne connaît jamais le rôle, elle affiche la
 * connexion dès que le tableau de bord lui est refusé.
 *
 * Découpage MVC strict :
 *   M — tableau de bord, état de la page, saisie, erreurs, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Jour d'un retrait au-delà d'hier ou de demain (« lun. 26/10 »). Les dates
// sont lues en UTC : ce sont des jours du calendrier, sans heure.
const SHORT_DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "2-digit", timeZone: "UTC" });

// Jour d'un retrait proche, selon son écart avec aujourd'hui (dayOffset de l'API).
const NEAR_DAYS = { "-1": "Hier", 0: "Auj.", 1: "Demain" };

// Classes d'une alerte de stock, écrites en entier. Le texte « 2 restants »
// reste en gris anthracite : l'orange Statut/Avertissement n'est pas assez
// contrasté pour du texte, il ne sert qu'au point.
const ALERT_CLASSES = {
  out: { dot: "bg-error", quantity: "text-accent" },
  low: { dot: "bg-warning", quantity: "text-ink" },
};

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  dashboard: null, // réponse de GET /api/admin/dashboard, ou null
  state: "login", // "dashboard", "login" ou "error"
  errorMessage: "", // message de l'état "error"
  notice: null, // { type, texte } au-dessus du contenu, ou null
  login: null, // { email, errors } du formulaire de connexion
  isSubmitting: false, // une connexion est en cours
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.dashboard = null;
  M.state = "login";
  M.errorMessage = "";
  M.notice = null;
  M.login = { email: "", errors: {} };
  M.isSubmitting = false;
};

/**
 * Charge le tableau de bord. Un refus du serveur (401, 403) mène à la
 * connexion ; toute autre erreur, à l'état "error". Le message précédent
 * est effacé.
 *
 * @returns {Promise<void>}
 */
M.loadDashboard = async function () {
  M.notice = null;

  try {
    M.dashboard = await AdminData.fetchDashboard();
    M.state = "dashboard";
  } catch (error) {
    M.dashboard = null;

    if (error.statut === 401) {
      M.state = "login";
    } else if (error.statut === 403) {
      M.state = "login";
      M.notice = {
        type: "erreur",
        texte: "Vous êtes connecté avec un compte client. Connectez-vous avec un compte administrateur.",
      };
    } else {
      M.state = "error";
      M.errorMessage =
        error.statut === undefined
          ? "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez."
          : `Impossible de charger le tableau de bord : ${error.message}`;
    }
  }
};

/**
 * Début d'une connexion : retient l'identifiant saisi, pour que le
 * formulaire reconstruit pendant l'envoi le garde.
 *
 * @param {string} email
 * @returns {boolean} false si une connexion est déjà en cours.
 */
M.startLogin = function (email) {
  if (M.isSubmitting) return false;

  M.isSubmitting = true;
  M.login.email = email;
  return true;
};

/**
 * Connexion du back-office, puis chargement du tableau de bord. Comme sur la
 * page Connexion des clients, un refus s'affiche sous le mot de passe.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<boolean>} true si le tableau de bord est affiché.
 */
M.submitLogin = async function (email, password) {
  M.login.errors = {};
  M.notice = null;

  try {
    await AdminData.login(email, password);
  } catch (error) {
    if (error.statut === 401) {
      M.login.errors = { password: error.message };
    } else if (error.statut === undefined) {
      M.notice = { type: "erreur", texte: "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez." };
    } else {
      M.notice = { type: "erreur", texte: `Une erreur est survenue : ${error.message}` };
    }
    M.isSubmitting = false;
    return false;
  }

  await M.loadDashboard();
  M.isSubmitting = false;
  return M.state === "dashboard";
};

/**
 * @param {number} count
 * @param {string} singular - Par exemple « catégorie ».
 * @param {string} plural - Par exemple « catégories ».
 * @returns {string} « 1 catégorie », « 4 catégories »…
 */
M.formatCount = function (count, singular, plural) {
  return `${count} ${count > 1 ? plural : singular}`;
};

/**
 * @param {number} id - Identifiant de la commande.
 * @returns {string} Numéro affiché, par exemple « CMD-0142 ».
 */
M.formatOrderNumber = function (id) {
  return `CMD-${String(id).padStart(4, "0")}`;
};

/**
 * @param {{firstName: string, lastName: string}} customer
 * @returns {string} Par exemple « A. Martin ».
 */
M.formatCustomer = function (customer) {
  return `${customer.firstName.charAt(0)}. ${customer.lastName}`;
};

/**
 * @param {string} pickupStart - Début du créneau, « 2026-10-21 16:00:00 ».
 * @param {number} dayOffset - Écart avec aujourd'hui : 0, 1, -1…
 * @returns {string} « Auj. 16 h », « Demain 10 h » ou « lun. 26/10 14 h ».
 */
M.formatPickup = function (pickupStart, dayOffset) {
  let day = NEAR_DAYS[dayOffset] ?? SHORT_DAY.format(new Date(`${pickupStart.slice(0, 10)}T00:00:00Z`));
  return `${day} ${Number(pickupStart.slice(11, 13))} h`;
};

/**
 * @param {Array<{name: string}>} soldOut - Produits épuisés.
 * @returns {string} Précision de la carte « Produits épuisés ».
 */
M.formatSoldOutCaption = function (soldOut) {
  if (soldOut.length === 0) return "Tous les produits sont en stock";
  if (soldOut.length === 1) return soldOut[0].name;
  return `${soldOut[0].name} et ${M.formatCount(soldOut.length - 1, "autre", "autres")}`;
};

/**
 * @returns {Array<{label: string, value: string, caption: string, tone: "default"|"alert"}>}
 *   Les quatre cartes indicateurs, dans l'ordre de la maquette.
 */
M.getStats = function () {
  let stats = M.dashboard.stats;

  return [
    {
      label: "Produits en ligne",
      value: String(stats.productCount),
      caption: M.formatCount(stats.categoryCount, "catégorie", "catégories"),
      tone: "default",
    },
    { label: "Commandes (total)", value: String(stats.orderCount), caption: "depuis l’ouverture", tone: "default" },
    {
      label: "Commandes en cours",
      value: String(stats.inProgressCount),
      caption: `${M.formatCount(stats.availableCount, "disponible", "disponibles")} au retrait`,
      tone: "default",
    },
    {
      label: "Produits épuisés",
      value: String(stats.soldOut.length),
      caption: M.formatSoldOutCaption(stats.soldOut),
      tone: stats.soldOut.length > 0 ? "alert" : "default",
    },
  ];
};

/**
 * @returns {Array<{number: string, customer: string, pickup: string, total: string, status: string}>}
 *   Les prochaines commandes, mises en forme.
 */
M.getOrders = function () {
  return M.dashboard.upcomingOrders.map((order) => ({
    number: M.formatOrderNumber(order.id),
    customer: M.formatCustomer(order.customer),
    pickup: M.formatPickup(order.pickupStart, order.dayOffset),
    total: formatPrice(order.total),
    status: order.status,
  }));
};

/**
 * @returns {{rows: Array<{name: string, quantity: string, status: "low"|"out"}>,
 *   moreLabel: string, moreCount: number}}
 *   Les alertes détaillées, puis le nombre de celles qui ne le sont pas.
 */
M.getAlerts = function () {
  let moreCount = M.dashboard.stockAlertCount - M.dashboard.stockAlerts.length;

  return {
    rows: M.dashboard.stockAlerts.map((alert) => ({
      // « Unique » : produit sans déclinaison, le nom suffit.
      name: alert.label === "Unique" ? alert.name : `${alert.name} · ${alert.label}`,
      quantity: alert.stock === 0 ? "épuisé" : M.formatCount(alert.stock, "restant", "restants"),
      status: getStockStatus(alert.stock, alert.lowStockThreshold),
    })),
    moreLabel: M.formatCount(moreCount, "autre variante", "autres variantes"),
    moreCount,
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "dashboard"|"login"|"error", notice: ?{type: string, texte: string},
 *   errorMessage: string, login: {email: string, errors: Object<string, string>, isSubmitting: boolean},
 *   dashboard: ?{firstName: string, stats: ReturnType<typeof M.getStats>,
 *     orders: ReturnType<typeof M.getOrders>, alerts: ReturnType<typeof M.getAlerts>}}}
 */
M.getViewData = function () {
  return {
    state: M.state,
    notice: M.notice,
    errorMessage: M.errorMessage,
    login: { ...M.login, isSubmitting: M.isSubmitting },
    dashboard:
      M.dashboard === null
        ? null
        : {
            firstName: M.dashboard.admin.firstName,
            stats: M.getStats(),
            orders: M.getOrders(),
            alerts: M.getAlerts(),
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
  await M.loadDashboard();
  return V.init(M.getViewData());
};

/**
 * Envoi du formulaire de connexion. En cas de succès, le tableau de bord
 * remplace le formulaire et le focus va à son titre ; sinon, au champ en
 * erreur.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<void>}
 */
C.handler_login = async function (email, password) {
  if (!M.startLogin(email)) return;
  V.renderContent(M.getViewData());

  let isConnected = await M.submitLogin(email, password);

  V.renderContent(M.getViewData());
  if (isConnected) {
    V.focusTitle();
  } else {
    V.focusFirstError();
  }
};

/**
 * Clic sur « Réessayer » (état "error").
 *
 * @returns {Promise<void>}
 */
C.handler_retry = async function () {
  await M.loadDashboard();
  V.renderContent(M.getViewData());
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  content: null, // contenu affiché : tableau de bord, connexion ou erreur
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

  V.notice = page.querySelector("[data-admin-notice]");
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
V.renderContent = function (data) {
  V.notice.replaceChildren(MessageView.dom(data.notice));
  V.content = replaceKeepingFocus(V.content, V.createContentFragment(data));
};

/**
 * Donne le focus au titre de la page (après la connexion : le formulaire
 * utilisé a disparu).
 */
V.focusTitle = function () {
  V.content.querySelector("h1").focus();
};

/**
 * Donne le focus au premier champ en erreur, s'il y en a un.
 */
V.focusFirstError = function () {
  V.content.querySelector('[aria-invalid="true"]')?.focus();
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} Le contenu de l'état courant.
 */
V.createContentFragment = function (data) {
  if (data.state === "dashboard") {
    return V.createDashboardFragment(data.dashboard);
  }

  if (data.state === "error") {
    let fragment = htmlToFragment(genericRenderer(templateError, { message: data.errorMessage }));
    fragment.querySelector('[data-action="retry"]').addEventListener("click", C.handler_retry);
    return fragment;
  }

  let fragment = htmlToFragment(templateLogin);
  fragment
    .querySelector('slot[name="form"]')
    .replaceWith(AdminLoginFormView.dom(data.login, { onLogin: C.handler_login }));
  return fragment;
};

/**
 * @param {NonNullable<ReturnType<typeof M.getViewData>["dashboard"]>} dashboard
 * @returns {DocumentFragment} Le tableau de bord complet.
 */
V.createDashboardFragment = function (dashboard) {
  let fragment = htmlToFragment(genericRenderer(templateDashboard, { firstName: dashboard.firstName }));

  let stats = document.createDocumentFragment();
  stats.append(...dashboard.stats.map((stat) => StatCardView.dom(stat)));
  fragment.querySelector('slot[name="stats"]').replaceWith(stats);

  fragment.querySelector('slot[name="orders"]').replaceWith(V.createOrdersFragment(dashboard.orders));
  fragment.querySelector('slot[name="alerts"]').replaceWith(V.createAlertsFragment(dashboard.alerts));

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getOrders>} orders
 * @returns {DocumentFragment} Le tableau des commandes, ou le message « aucune commande ».
 */
V.createOrdersFragment = function (orders) {
  if (orders.length === 0) {
    return htmlToFragment(templateOrdersEmpty);
  }

  let fragment = htmlToFragment(templateOrdersTable);
  fragment.querySelector("[data-order-rows]").append(...orders.map(V.createOrderRowFragment));
  return fragment;
};

/**
 * @param {ReturnType<typeof M.getOrders>[number]} order
 * @returns {DocumentFragment} Une ligne du tableau.
 */
V.createOrderRowFragment = function (order) {
  let fragment = htmlToFragment(genericRenderer(templateOrderRow, order));
  fragment.querySelector('slot[name="status"]').replaceWith(OrderStatusBadgeView.dom(order.status));
  return fragment;
};

/**
 * @param {ReturnType<typeof M.getAlerts>} alerts
 * @returns {DocumentFragment} La liste des alertes, ou le message « aucune alerte ».
 */
V.createAlertsFragment = function (alerts) {
  if (alerts.rows.length === 0) {
    return htmlToFragment(templateAlertsEmpty);
  }

  let fragment = htmlToFragment(genericRenderer(templateAlerts, { moreLabel: alerts.moreLabel }));
  fragment.querySelector("[data-alert-rows]").append(
    ...alerts.rows.map((row) =>
      htmlToFragment(
        genericRenderer(templateAlertRow, {
          name: row.name,
          quantity: row.quantity,
          dotClass: ALERT_CLASSES[row.status].dot,
          quantityClass: ALERT_CLASSES[row.status].quantity,
        }),
      ),
    ),
  );
  fragment.querySelector("[data-alert-more]").hidden = alerts.moreCount === 0;
  return fragment;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function AdminPage() {
  return C.init();
}
