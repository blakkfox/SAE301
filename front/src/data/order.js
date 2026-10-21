import { getRequest, postRequest } from "../lib/api-request.js";

/**
 * Validation de la commande (US CMD-a) et historique du client (US SUI-c).
 *
 * Les appels exigent un compte connecté : sinon l'API répond 401.
 * Le serveur recalcule les créneaux, revérifie les quantités et le stock, et
 * relit les prix en base : la commande envoyée ne contient que des choix
 * (concession, créneau) et des identifiants de variantes avec leur quantité.
 */

let OrderData = {};

/**
 * Ce qu'il faut pour valider : GET /api/checkout
 *
 * @returns {Promise<{customer: {firstName: string, lastName: string, email: string, phone: string,
 *     preferredDealershipId: ?number},
 *   dealerships: Array<{id: number, name: string, shortName: string, address: string, hoursLabel: string}>,
 *   slots: Array<{id: string, date: string, dayOffset: number, startHour: number, endHour: number}>}>}
 *   slots : prochains créneaux de retrait ; dayOffset vaut 0 aujourd'hui, 1 demain…
 *   preferredDealershipId : concession choisie dans l'espace personnel (SUI-b), ou null.
 * @throws {ErreurApi} 401 si personne n'est connecté.
 */
OrderData.fetchCheckout = async function () {
  return getRequest("checkout");
};

/**
 * Enregistre la commande : POST /api/orders
 *
 * @param {{dealershipId: number, slot: string,
 *   items: Array<{variantId: number, quantity: number}>}} order
 * @returns {Promise<{order: {id: number, status: string, total: number, pickupStart: string,
 *   pickupEnd: string, createdAt: string, dealership: {id: number, name: string, shortName: string},
 *   lines: Array<{variantId: ?number, name: string, label: string, reference: string,
 *     unitPrice: number, quantity: number}>}}>}
 * @throws {ErreurApi} 401 (non connecté), 400 (articles invalides), 422 (concession
 *   ou créneau refusé, détail dans champs), 409 (stock insuffisant : rien n'est enregistré).
 */
OrderData.create = async function (order) {
  return postRequest("orders", order);
};

/**
 * Historique du compte connecté (US SUI-c) : GET /api/orders?period=6
 *
 * @param {string} period - « 3 », « 6 », « 12 » (derniers mois) ou « all ».
 * @returns {Promise<{period: string, orders: Array<{id: number, status: string, total: number,
 *   pickupStart: string, pickupEnd: string, createdAt: string, dayOffset: number,
 *   dealership: {id: number, name: string, shortName: string},
 *   lines: Array<{variantId: ?number, name: string, label: string, reference: string,
 *     unitPrice: number, quantity: number}>,
 *   events: Array<{status: string, createdAt: string}>}>}>}
 *   orders : des plus récentes aux plus anciennes ; period : la période appliquée.
 * @throws {ErreurApi} 401 si personne n'est connecté.
 */
OrderData.fetchHistory = async function (period) {
  return getRequest(`orders?period=${encodeURIComponent(period)}`);
};

export { OrderData };
