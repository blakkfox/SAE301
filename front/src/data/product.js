import { getRequest } from "../lib/api-request.js";

// Dossier des photos produit : front/public/images/produits/, copié tel quel
// par Vite à la racine du site (BASE dans vite.config.js).
const IMAGE_DIR = import.meta.env.BASE_URL + "images/produits/";

let ProductData = {};

/**
 * Une page du catalogue : GET /api/products?page=…&sort=…&category=…
 *
 * variantId est la variante unique du produit (ajout au panier depuis la
 * carte, CMD-b), ou null si le produit en a plusieurs. stock est le stock
 * total de ses variantes (STK-b), lowStockThreshold le seuil « Bientôt
 * épuisé » du produit (GOF-a). price est le prix à payer : pour le produit
 * en promotion automatique (PRO-c), originalPrice est le prix avant remise et
 * discountRate la réduction en pour cent ; tous deux valent null sinon.
 * promotion est ce produit en promotion (comme fetchPromotion), ou null.
 *
 * sort n'est fourni qu'après un choix de l'utilisateur. Sans lui, le serveur
 * applique le tri qu'il a mémorisé (cookie), ou le tri par défaut.
 * category limite la liste à une catégorie et à ses sous-catégories (DEC-a).
 * inStockOnly masque les produits épuisés (STK-b) : total et pagination ne
 * comptent alors que les produits en stock.
 *
 * @param {number} page - Numéro de page demandé (le serveur le borne).
 * @param {string} [sort] - Clé de tri : price_asc, price_desc, name_asc, newest.
 * @param {string} [category] - Slug de la catégorie, par exemple « collection-honda ».
 * @param {boolean} [inStockOnly=false] - true pour masquer les produits épuisés.
 * @returns {Promise<{products: Array<{id: number, name: string, price: number,
 *   originalPrice: ?number, discountRate: ?number, image: ?string,
 *   variantId: ?number, stock: number, lowStockThreshold: number}>,
 *   sort: string, page: number, pageCount: number, perPage: number, total: number,
 *   promotion: ?{id: number, name: string, price: number, originalPrice: number, discountRate: number}}>}
 * @throws {ErreurApi} Si le serveur répond par une erreur (404 : catégorie inconnue).
 */
ProductData.fetchPage = async function (page, sort, category, inStockOnly = false) {
  let uri = `products?page=${encodeURIComponent(page)}`;

  if (sort !== undefined) {
    uri += `&sort=${encodeURIComponent(sort)}`;
  }

  if (category !== undefined) {
    uri += `&category=${encodeURIComponent(category)}`;
  }

  if (inStockOnly) {
    uri += "&inStock=1";
  }

  return getRequest(uri);
};

/**
 * La fiche d'un produit : GET /api/product?id=…
 *
 * options sont les options à cocher du produit (OPT-c), avec leur supplément.
 * price, originalPrice et discountRate : comme fetchPage (PRO-c).
 *
 * @param {string|number} id - Identifiant du produit (paramètre de l'URL).
 * @returns {Promise<{product: {id: number, name: string, description: ?string, price: number,
 *   originalPrice: ?number, discountRate: ?number, image: ?string, variantAxis: ?string, lowStockThreshold: number,
 *   category: {id: number, name: string, slug: string,
 *     parent: ?{id: number, name: string, slug: string}},
 *   variants: Array<{id: number, label: string, reference: string, stock: number}>,
 *   features: Array<{label: string, value: string}>,
 *   options: Array<{id: number, label: string, description: ?string, price: number}>},
 *   related: Array<{id: number, name: string, price: number, originalPrice: ?number,
 *     discountRate: ?number, image: ?string, variantId: ?number,
 *     stock: number, lowStockThreshold: number}>}>}
 * @throws {ErreurApi} 400 si l'identifiant est invalide, 404 si le produit n'existe pas.
 */
ProductData.fetchOne = async function (id) {
  return getRequest(`product?id=${encodeURIComponent(id)}`);
};

/**
 * La promotion automatique du moment (PRO-c) : GET /api/promotion
 *
 * Le serveur la recalcule à chaque requête : c'est le produit le plus en
 * stock, et elle change avec les ventes et les réassorts.
 *
 * @returns {Promise<{promotion: ?{id: number, name: string, price: number,
 *   originalPrice: number, discountRate: number}}>} promotion vaut null si
 *   aucun produit n'est en promotion.
 * @throws {ErreurApi} Si le serveur répond par une erreur.
 */
ProductData.fetchPromotion = async function () {
  return getRequest("promotion");
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
