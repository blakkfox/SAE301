import { getRequest, postRequest } from "../lib/api-request.js";
import { AuthData } from "./auth.js";

/**
 * Espace personnel (US SUI-b).
 *
 * Les appels exigent un compte connecté : sinon l'API répond 401. Le compte
 * modifié est celui de la session ; le serveur valide toutes les saisies.
 */

let AccountData = {};

/**
 * Informations du compte, concessions et dernière commande : GET /api/account
 *
 * @returns {Promise<{customer: {firstName: string, lastName: string, email: string, phone: string,
 *   preferredDealershipId: ?number},
 *   dealerships: Array<{id: number, name: string, shortName: string, address: string, hoursLabel: string}>,
 *   lastOrder: ?{id: number, status: string, total: number, pickupStart: string, pickupEnd: string,
 *     createdAt: string, dayOffset: number, dealership: {id: number, name: string, shortName: string},
 *     lines: Array<Object>}}>}
 *   lastOrder : la commande la plus récente, ou null ; dayOffset vaut 0 si le retrait est aujourd'hui.
 * @throws {ErreurApi} 401 si personne n'est connecté.
 */
AccountData.fetch = async function () {
  return getRequest("account");
};

/**
 * Enregistre les informations du compte : POST /api/account
 *
 * @param {{firstName: string, lastName: string, email: string, phone: string,
 *   preferredDealershipId: ?number}} profile - preferredDealershipId : null pour aucune préférence.
 * @returns {Promise<{customer: Object}>} Le compte tel qu'enregistré ; l'en-tête
 *   en est prévenu (AuthData.notify), le prénom a pu changer.
 * @throws {ErreurApi} 401 (non connecté), 422 (saisie invalide) ou 409 (adresse
 *   déjà prise), avec les erreurs de chaque champ dans champs.
 */
AccountData.update = async function (profile) {
  let response = await postRequest("account", profile);
  AuthData.notify(response.customer);
  return response;
};

/**
 * Change le mot de passe : POST /api/account/password
 *
 * @param {{currentPassword: string, password: string, passwordConfirm: string}} change
 * @returns {Promise<{modifie: boolean}>}
 * @throws {ErreurApi} 401 (non connecté) ou 422 (mot de passe actuel faux,
 *   nouveau mot de passe invalide), avec les erreurs de chaque champ dans champs.
 */
AccountData.changePassword = async function (change) {
  return postRequest("account/password", change);
};

export { AccountData };
