import { getRequest } from "../lib/api-request.js";

let CategoryData = {};

/**
 * L'arbre des catégories : GET /api/categories
 *
 * productCount compte aussi les produits des sous-catégories ; total est le
 * nombre de produits de tout le catalogue (« Tous les produits »).
 *
 * @returns {Promise<{categories: Array<{id: number, parentId: null, name: string, slug: string,
 *   description: ?string, productCount: number,
 *   children: Array<{id: number, parentId: number, name: string, slug: string,
 *     description: ?string, productCount: number}>}>,
 *   total: number}>}
 * @throws {ErreurApi} Si le serveur répond par une erreur.
 */
CategoryData.fetchAll = async function () {
  return getRequest("categories");
};

export { CategoryData };
