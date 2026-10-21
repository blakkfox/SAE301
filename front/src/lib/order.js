/**
 * Mise en forme des commandes au back-office (US PIL-b) et dans l'historique
 * du client (US SUI-c) : numéro, client, créneau de retrait, statut.
 * Fonctions pures, sans dépendance.
 */

// Jour d'un retrait au-delà d'hier ou de demain (« lun. 26/10 »). Les dates
// sont lues en UTC : ce sont des jours du calendrier, sans heure.
const SHORT_DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "2-digit", timeZone: "UTC" });

// Jour d'un retrait proche, selon son écart avec aujourd'hui (dayOffset de l'API).
const NEAR_DAYS = { "-1": "Hier", 0: "Auj.", 1: "Demain" };

// Même jour, dans une phrase (« retrait aujourd'hui 16 h – 18 h »).
const NEAR_DAYS_SENTENCE = { "-1": "hier", 0: "aujourd’hui", 1: "demain" };

/**
 * Statut d'une commande, en minuscules, pour une phrase (« passée à
 * « disponible » »). La pastille a ses propres libellés (OrderStatusBadgeView).
 */
export const ORDER_STATUS_WORDS = {
  en_cours: "en cours",
  disponible: "disponible",
  retiree: "retirée",
  annulee: "annulée",
};

/**
 * @param {number} id - Identifiant de la commande.
 * @returns {string} Numéro affiché, par exemple « CMD-0142 ».
 */
export function formatOrderNumber(id) {
  return `CMD-${String(id).padStart(4, "0")}`;
}

/**
 * @param {{firstName: string, lastName: string}} customer
 * @returns {string} Par exemple « M. Dupont ».
 */
export function formatCustomerShort(customer) {
  return `${customer.firstName.charAt(0)}. ${customer.lastName}`;
}

/**
 * @param {string} phone - Numéro enregistré, par exemple « 0601020304 ».
 * @returns {string} « 06 01 02 03 04 », ou le numéro tel quel s'il n'a pas 10 chiffres.
 */
export function formatPhone(phone) {
  return /^\d{10}$/.test(phone) ? phone.replace(/(\d{2})(?=\d)/g, "$1 ") : phone;
}

/**
 * @param {string} datetime - Date MySQL, « 2026-10-21 16:00:00 ».
 * @returns {number} L'heure, par exemple 16.
 */
function hourOf(datetime) {
  return Number(datetime.slice(11, 13));
}

/**
 * @param {string} datetime - Date MySQL, « 2026-10-21 16:00:00 ».
 * @returns {string} Le jour du calendrier, par exemple « mer. 21/10 ».
 */
function shortDayOf(datetime) {
  return SHORT_DAY.format(new Date(`${datetime.slice(0, 10)}T00:00:00Z`));
}

/**
 * @param {string} pickupStart - Début du créneau, « 2026-10-21 16:00:00 ».
 * @param {number} dayOffset - Écart avec aujourd'hui : 0, 1, -1…
 * @returns {string} « Auj. 16 h », « Demain 10 h » ou « lun. 26/10 14 h ».
 */
export function formatPickupShort(pickupStart, dayOffset) {
  return `${NEAR_DAYS[dayOffset] ?? shortDayOf(pickupStart)} ${hourOf(pickupStart)} h`;
}

/**
 * @param {string} pickupStart - Début du créneau.
 * @param {string} pickupEnd - Fin du créneau.
 * @param {number} dayOffset - Écart avec aujourd'hui.
 * @returns {string} « aujourd’hui 16 h – 18 h » ou « le lun. 26/10 14 h – 16 h ».
 */
export function formatPickupLong(pickupStart, pickupEnd, dayOffset) {
  let day = NEAR_DAYS_SENTENCE[dayOffset] ?? `le ${shortDayOf(pickupStart)}`;
  return `${day} ${hourOf(pickupStart)} h – ${hourOf(pickupEnd)} h`;
}

/**
 * @param {string} datetime - Date MySQL, « 2026-10-13 14:02:37 ».
 * @returns {string} « 13/10 14:02 ».
 */
export function formatEventTime(datetime) {
  return `${datetime.slice(8, 10)}/${datetime.slice(5, 7)} ${datetime.slice(11, 16)}`;
}

/**
 * @param {string} datetime - Date MySQL, « 2026-10-13 14:02:37 ».
 * @returns {string} « 13/10/2026 ».
 */
export function formatOrderDate(datetime) {
  return `${datetime.slice(8, 10)}/${datetime.slice(5, 7)}/${datetime.slice(0, 4)}`;
}
