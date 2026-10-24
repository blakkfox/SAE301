import { getRequest, postRequest } from "../lib/api-request.js";

/**
 * Validation de la commande (US CMD-a), historique du client (US SUI-c) et
 * détail d'une commande, pour la commander à nouveau (US SUI-a).
 *
 * Les appels exigent un compte connecté : sinon l'API répond 401.
 * Le serveur recalcule les créneaux, revérifie les quantités et le stock, et
 * relit les prix en base : la commande envoyée ne contient que des choix
 * (concession, créneau) et des identifiants de variantes avec leur quantité
 * et leurs options (US OPT-a), dont le serveur relit les suppléments, et le
 * code promo saisi (US PRO-a), dont il revérifie la validité et recalcule la
 * remise.
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
 *   items: Array<{variantId: number, quantity: number, optionIds: number[]}>,
 *   promoCode: ?string}} order - promoCode : code promo (PRO-a), ou null.
 * @returns {Promise<{order: {id: number, status: string, total: number, promoCode: ?string,
 *   discount: number, pickupStart: string,
 *   pickupEnd: string, createdAt: string, dealership: {id: number, name: string, shortName: string},
 *   lines: Array<{variantId: ?number, name: string, label: string, reference: string,
 *     unitPrice: number, quantity: number, options: Array<{label: string, price: number}>}>}}>}
 *   unitPrice : prix d'un article, suppléments des options compris ; total : déjà
 *   diminué de discount, la remise du code promo (0 sans code).
 * @throws {ErreurApi} 401 (non connecté), 400 (articles invalides), 422 (concession,
 *   créneau, option ou code promo refusé, détail dans champs), 409 (stock insuffisant :
 *   rien n'est enregistré).
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

/**
 * Une commande du compte connecté (US SUI-a) : GET /api/order?id=97
 *
 * @param {number} id
 * @returns {Promise<{order: {id: number, status: string, total: number, pickupStart: string,
 *   pickupEnd: string, createdAt: string, dayOffset: number,
 *   dealership: {id: number, name: string, shortName: string},
 *   lines: Array<{variantId: ?number, name: string, label: string, reference: string,
 *     unitPrice: number, quantity: number, options: Array<{label: string, price: number}>}>,
 *   events: Array<{status: string, createdAt: string}>}}>}
 *   lines : prix figés à la commande ; le stock actuel se lit avec CartData.fetchVariants.
 * @throws {ErreurApi} 401 (non connecté), 400 (identifiant invalide), 404 (commande
 *   introuvable ou d'un autre compte).
 */
OrderData.fetchOne = async function (id) {
  return getRequest(`order?id=${encodeURIComponent(id)}`);
};

export { OrderData };
