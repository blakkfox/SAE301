import { getRequest, postRequest } from "../lib/api-request.js";

/**
 * Validation de la commande (US CMD-a).
 *
 * Les deux appels exigent un compte connecté : sinon l'API répond 401.
 * Le serveur recalcule les créneaux, revérifie les quantités et le stock, et
 * relit les prix en base : la commande envoyée ne contient que des choix
 * (concession, créneau) et des identifiants de variantes avec leur quantité.
 */

let OrderData = {};

/**
 * Ce qu'il faut pour valider : GET /api/checkout
 *
 * @returns {Promise<{customer: {firstName: string, lastName: string, email: string, phone: string},
 *   dealerships: Array<{id: number, name: string, shortName: string, address: string, hoursLabel: string}>,
 *   slots: Array<{id: string, date: string, dayOffset: number, startHour: number, endHour: number}>}>}
 *   slots : prochains créneaux de retrait ; dayOffset vaut 0 aujourd'hui, 1 demain…
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

export { OrderData };
