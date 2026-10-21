import { getRequest, postRequest } from "../lib/api-request.js";

/**
 * Back-office (US GOF-b).
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

export { AdminData };
