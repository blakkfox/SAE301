import { postRequest } from "../lib/api-request.js";

let AuthData = {};

/**
 * Connexion : POST /api/login
 * En cas de succès, le serveur ouvre une session ; le cookie PHPSESSID qu'il
 * renvoie accompagnera ensuite chaque requête.
 */
AuthData.login = async function (login, mdp) {
  return postRequest("login", { login, mdp });
};

/**
 * Déconnexion : POST /api/logout
 */
AuthData.logout = async function () {
  return postRequest("logout");
};

export { AuthData };
