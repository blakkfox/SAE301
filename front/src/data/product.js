import { getRequest } from "../lib/api-request.js";

// Dossier des photos produit : front/public/images/produits/, copié tel quel
// par Vite à la racine du site (BASE dans vite.config.js).
const IMAGE_DIR = import.meta.env.BASE_URL + "images/produits/";

let ProductData = {};

/**
 * Une page du catalogue : GET /api/products?page=…&sort=…
 *
 * sort n'est fourni qu'après un choix de l'utilisateur. Sans lui, le serveur
 * applique le tri qu'il a mémorisé (cookie), ou le tri par défaut.
 *
 * @param {number} page - Numéro de page demandé (le serveur le borne).
 * @param {string} [sort] - Clé de tri : price_asc, price_desc, name_asc, newest.
 * @returns {Promise<{products: Array<{id: number, name: string, price: number, image: ?string}>,
 *   sort: string, page: number, pageCount: number, perPage: number, total: number}>}
 * @throws {ErreurApi} Si le serveur répond par une erreur.
 */
ProductData.fetchPage = async function (page, sort) {
  let uri = `products?page=${encodeURIComponent(page)}`;

  if (sort !== undefined) {
    uri += `&sort=${encodeURIComponent(sort)}`;
  }

  return getRequest(uri);
};

/**
 * La fiche d'un produit : GET /api/product?id=…
 *
 * @param {string|number} id - Identifiant du produit (paramètre de l'URL).
 * @returns {Promise<{product: {id: number, name: string, description: ?string, price: number,
 *   image: ?string, category: {id: number, name: string, slug: string},
 *   variants: Array<{id: number, label: string, reference: string}>,
 *   features: Array<{label: string, value: string}>},
 *   related: Array<{id: number, name: string, price: number, image: ?string}>}>}
 * @throws {ErreurApi} 400 si l'identifiant est invalide, 404 si le produit n'existe pas.
 */
ProductData.fetchOne = async function (id) {
  return getRequest(`product?id=${encodeURIComponent(id)}`);
};

/**
 * Adresse d'une photo produit à partir du nom de fichier renvoyé par l'API.
 *
 * @param {?string} image - Nom de fichier, ou null si le produit n'a pas de photo.
 * @returns {?string} L'adresse de la photo, ou null.
 */
ProductData.imageUrl = function (image) {
  return image === null ? null : IMAGE_DIR + encodeURIComponent(image);
};

export { ProductData };
