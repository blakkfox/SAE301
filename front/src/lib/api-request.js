/**
 * Appels à l'API.
 *
 * L'API est servie avec le front, sous le même chemin :
 * /~login/Base/api/... (import.meta.env.BASE_URL vaut /~login/Base/).
 *
 * Front et API ayant la même origine, le navigateur joint automatiquement les
 * cookies du site à chaque requête : aucune option n'est nécessaire ici.
 */
const API_URL = import.meta.env.BASE_URL + "api/";

/**
 * Erreur renvoyée par l'API, avec son code de statut HTTP.
 *
 * Une page a parfois besoin de distinguer un 401 d'un 403 pour afficher le bon
 * message : le message seul ne le permettrait pas.
 *
 * champs : erreurs de saisie, une par champ ({ email: "…" }), quand l'API
 * en renvoie (formulaires de CMD-c) ; un objet vide sinon.
 * donnees : le corps complet de la réponse d'erreur, pour les détails propres
 * à une route (variantes « indisponibles » d'un 409 de CMD-a) ; null si illisible.
 */
class ErreurApi extends Error {
  constructor(message, statut, champs = {}, donnees = null) {
    super(message);
    this.name = "ErreurApi";
    this.statut = statut;
    this.champs = champs;
    this.donnees = donnees;
  }
}

/**
 * Envoie une requête et renvoie la réponse JSON, convertie en objet.
 * Lève une ErreurApi si le serveur répond par une erreur.
 */
let request = async function (uri, options) {
  const response = await fetch(API_URL + uri, options);

  let data = null;
  try {
    data = await response.json();
  } catch (e) {
    throw new ErreurApi("Réponse illisible du serveur.", response.status);
  }

  if (!response.ok) {
    // L'API décrit ses erreurs dans un champ « erreur ».
    throw new ErreurApi(data?.erreur ?? `Erreur ${response.status}`, response.status, data?.champs ?? {}, data);
  }

  return data;
};

/**
 * Lecture d'une ressource. Par exemple : await getRequest("products?page=2")
 */
let getRequest = function (uri) {
  return request(uri, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
};

/**
 * Envoi de données au format JSON. Par exemple :
 * await postRequest("login", { login: "alice", mdp: "azerty" })
 */
let postRequest = function (uri, data = {}) {
  return request(uri, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
};

/**
 * Envoi d'un fichier, en formulaire multipart. Le navigateur pose lui-même
 * l'en-tête Content-Type, avec la frontière qui sépare les parties. Par
 * exemple : await postFileRequest("admin/products/images", "image", fichier)
 *
 * @param {string} uri - Route de l'API.
 * @param {string} field - Nom du champ qui porte le fichier.
 * @param {File} file - Fichier choisi par l'utilisateur.
 */
let postFileRequest = function (uri, field, file) {
  let body = new FormData();
  body.append(field, file);

  return request(uri, {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
  });
};

export { getRequest, postRequest, postFileRequest, ErreurApi };
