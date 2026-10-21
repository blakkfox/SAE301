import { getRequest, postRequest } from "../lib/api-request.js";

/**
 * Authentification (US CMD-c).
 *
 * La session est tenue par le serveur : le navigateur ne garde que le cookie
 * PHPSESSID, en HttpOnly, que le JavaScript ne peut pas lire. Pour savoir qui
 * est connecté, on le demande donc à l'API (fetchCurrent).
 *
 * Un compte renvoyé par l'API a la forme
 * { id, firstName, lastName, email, phone, role, preferredDealershipId }.
 *
 * Le compte connecté s'affiche dans l'en-tête (son prénom, SUI-b) :
 * subscribe permet d'être prévenu de chaque connexion, déconnexion ou
 * modification du compte.
 */

// Fonctions à appeler quand le compte connecté change.
const listeners = [];

let AuthData = {};

/**
 * @param {(customer: ?{firstName: string}) => void} listener - Appelée avec le
 *   compte connecté, ou null après une déconnexion.
 */
AuthData.subscribe = function (listener) {
  listeners.push(listener);
};

/**
 * Prévient les abonnés que le compte connecté a changé.
 *
 * @param {?{firstName: string}} customer - Le compte connecté, ou null.
 */
AuthData.notify = function (customer) {
  for (const listener of listeners) {
    listener(customer);
  }
};

/**
 * Compte connecté : GET /api/me
 *
 * @returns {Promise<{customer: ?{id: number, firstName: string, lastName: string,
 *   email: string, phone: string, role: string, preferredDealershipId: ?number}}>}
 *   customer vaut null si personne n'est connecté.
 * @throws {ErreurApi} Si le serveur répond par une erreur.
 */
AuthData.fetchCurrent = async function () {
  return getRequest("me");
};

/**
 * Connexion : POST /api/login
 * En cas de succès, le serveur ouvre une session ; le cookie PHPSESSID qu'il
 * renvoie accompagnera ensuite chaque requête.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{customer: Object}>} Le compte connecté.
 * @throws {ErreurApi} 401 si les identifiants sont incorrects.
 */
AuthData.login = async function (email, password) {
  let response = await postRequest("login", { email, password });
  AuthData.notify(response.customer);
  return response;
};

/**
 * Création de compte : POST /api/register. Le compte créé est aussitôt
 * connecté.
 *
 * @param {{firstName: string, lastName: string, email: string, phone: string,
 *   password: string, passwordConfirm: string}} account
 * @returns {Promise<{customer: Object}>} Le compte créé et connecté.
 * @throws {ErreurApi} 422 (saisie invalide) ou 409 (adresse déjà prise),
 *   avec les erreurs de chaque champ dans champs.
 */
AuthData.register = async function (account) {
  let response = await postRequest("register", account);
  AuthData.notify(response.customer);
  return response;
};

/**
 * Mot de passe oublié : POST /api/password-reset. Ne connecte pas.
 *
 * @param {{email: string, password: string, passwordConfirm: string}} reset
 * @returns {Promise<{modifie: boolean}>}
 * @throws {ErreurApi} 422 (saisie invalide) ou 404 (adresse inconnue), avec
 *   les erreurs de chaque champ dans champs.
 */
AuthData.resetPassword = async function (reset) {
  return postRequest("password-reset", reset);
};

/**
 * Déconnexion : POST /api/logout
 *
 * @returns {Promise<{customer: null}>}
 */
AuthData.logout = async function () {
  let response = await postRequest("logout");
  AuthData.notify(null);
  return response;
};

export { AuthData };
