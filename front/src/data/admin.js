import { getRequest, postRequest } from "../lib/api-request.js";

/**
 * Back-office : tableau de bord (US GOF-b) et gestion des commandes (US PIL-b).
 *
 * Le rôle n'est jamais connu du navigateur : c'est le serveur qui relit le
 * compte connecté et refuse le tableau de bord à tout autre qu'un
 * administrateur. La déconnexion est celle des clients (AuthData.logout).
 */

let AdminData = {};

/**
 * Connexion du back-office : POST /api/admin/login. Les comptes clients y
 * sont refusés.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{customer: Object}>} Le compte administrateur connecté.
 * @throws {ErreurApi} 401 si les identifiants sont incorrects ou si le compte
 *   n'est pas administrateur.
 */
AdminData.login = async function (email, password) {
  return postRequest("admin/login", { email, password });
};

/**
 * Tableau de bord : GET /api/admin/dashboard
 *
 * @returns {Promise<{admin: {firstName: string, lastName: string},
 *   stats: {productCount: number, categoryCount: number, orderCount: number,
 *     inProgressCount: number, availableCount: number, soldOut: Array<{id: number, name: string}>},
 *   upcomingOrders: Array<{id: number, status: string, total: number, pickupStart: string,
 *     dayOffset: number, customer: {firstName: string, lastName: string}}>,
 *   stockAlerts: Array<{variantId: number, productId: number, name: string, label: string, stock: number}>,
 *   stockAlertCount: number}>}
 *   dayOffset vaut 0 aujourd'hui, 1 demain, -1 hier ; stockAlerts ne détaille
 *   que les premières alertes, stockAlertCount les compte toutes.
 * @throws {ErreurApi} 401 si personne n'est connecté, 403 si le compte n'est
 *   pas administrateur.
 */
AdminData.fetchDashboard = async function () {
  return getRequest("admin/dashboard");
};

/**
 * Liste des commandes : GET /api/admin/orders?status=…&q=…&sort=…&page=…
 * Les réglages vides ne sont pas envoyés : le serveur applique alors ceux par
 * défaut, et les rappelle dans sa réponse.
 *
 * @param {{status: ?string, search: string, sort: ?string, page: number}} query
 * @returns {Promise<{admin: {firstName: string, lastName: string},
 *   counts: {all: number, en_cours: number, disponible: number, retiree: number, annulee: number},
 *   orders: Array<{id: number, status: string, total: number, pickupStart: string, dayOffset: number,
 *     customer: {firstName: string, lastName: string}}>,
 *   status: ?string, search: string, sort: string, page: number, pageCount: number,
 *   perPage: number, total: number}>}
 * @throws {ErreurApi} 401 si personne n'est connecté, 403 si le compte n'est
 *   pas administrateur.
 */
AdminData.fetchOrders = async function (query) {
  let params = new URLSearchParams({ page: String(query.page) });
  if (query.status !== null) params.set("status", query.status);
  if (query.search !== "") params.set("q", query.search);
  if (query.sort !== null) params.set("sort", query.sort);

  return getRequest(`admin/orders?${params}`);
};

/**
 * Détail d'une commande : GET /api/admin/order?id=…
 *
 * @param {number} id
 * @returns {Promise<{order: {id: number, status: string, total: number, pickupStart: string,
 *   pickupEnd: string, createdAt: string, dayOffset: number,
 *   dealership: {id: number, name: string, shortName: string},
 *   lines: Array<{variantId: ?number, name: string, label: string, reference: string,
 *     unitPrice: number, quantity: number}>,
 *   customer: {firstName: string, lastName: string, phone: string},
 *   events: Array<{status: string, createdAt: string, admin: ?{firstName: string, lastName: string}}>}}>}
 * @throws {ErreurApi} 404 si la commande n'existe pas ; 401, 403 comme fetchOrders.
 */
AdminData.fetchOrder = async function (id) {
  return getRequest(`admin/order?id=${encodeURIComponent(id)}`);
};

/**
 * Passage de commandes à « disponible » ou « retirée » :
 * POST /api/admin/orders/status. Le serveur ne change que les commandes dont
 * le statut actuel le permet.
 *
 * @param {number[]} ids
 * @param {"disponible"|"retiree"} status
 * @returns {Promise<{status: string, updated: number[], skipped: number[]}>}
 * @throws {ErreurApi} 400 si la sélection ou le statut est invalide ; 401, 403
 *   comme fetchOrders.
 */
AdminData.updateOrderStatus = async function (ids, status) {
  return postRequest("admin/orders/status", { ids, status });
};

/**
 * Annulation d'une commande, avec recrédit du stock :
 * POST /api/admin/orders/cancel.
 *
 * @param {number} id
 * @returns {Promise<{order: Object}>} La commande annulée, comme fetchOrder.
 * @throws {ErreurApi} 404 si la commande n'existe pas, 409 si elle est retirée
 *   ou déjà annulée ; 401, 403 comme fetchOrders.
 */
AdminData.cancelOrder = async function (id) {
  return postRequest("admin/orders/cancel", { id });
};

export { AdminData };
