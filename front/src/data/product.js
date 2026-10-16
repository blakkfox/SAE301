import { getRequest } from "../lib/api-request.js";

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

export { ProductData };
