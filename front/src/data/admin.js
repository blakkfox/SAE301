import { getRequest, postRequest } from "../lib/api-request.js";

/**
 * Back-office : tableau de bord (US GOF-b), gestion des commandes (US PIL-b),
 * des catégories (US GOF-c), des produits (US GOF-a) et des codes promo
 * (US PRO-b), statistiques (US PIL-a).
 *
 * Le rôle n'est jamais connu du navigateur : c'est le serveur qui relit le
 * compte connecté et refuse le tableau de bord à tout autre qu'un
 * administrateur. La déconnexion est celle des clients (AuthData.logout).
 */

let AdminData = {};

/**
 * Connexion du back-office : POST /api/admin/login. Les comptes clients y
 * sont refusés.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{customer: Object}>} Le compte administrateur connecté.
 * @throws {ErreurApi} 401 si les identifiants sont incorrects ou si le compte
 *   n'est pas administrateur.
 */
AdminData.login = async function (email, password) {
  return postRequest("admin/login", { email, password });
};

/**
 * Tableau de bord : GET /api/admin/dashboard
 *
 * @returns {Promise<{admin: {firstName: string, lastName: string},
 *   stats: {productCount: number, categoryCount: number, orderCount: number,
 *     inProgressCount: number, availableCount: number, soldOut: Array<{id: number, name: string}>},
 *   upcomingOrders: Array<{id: number, status: string, total: number, pickupStart: string,
 *     dayOffset: number, customer: {firstName: string, lastName: string}}>,
 *   stockAlerts: Array<{variantId: number, productId: number, name: string, label: string, stock: number,
 *     lowStockThreshold: number}>,
 *   stockAlertCount: number}>}
 *   dayOffset vaut 0 aujourd'hui, 1 demain, -1 hier ; stockAlerts ne détaille
 *   que les premières alertes, stockAlertCount les compte toutes.
 * @throws {ErreurApi} 401 si personne n'est connecté, 403 si le compte n'est
 *   pas administrateur.
 */
AdminData.fetchDashboard = async function () {
  return getRequest("admin/dashboard");
};

/**
 * Liste des commandes : GET /api/admin/orders?status=…&q=…&sort=…&page=…
 * Les réglages vides ne sont pas envoyés : le serveur applique alors ceux par
 * défaut, et les rappelle dans sa réponse.
 *
 * @param {{status: ?string, search: string, sort: ?string, page: number}} query
 * @returns {Promise<{admin: {firstName: string, lastName: string},
 *   counts: {all: number, en_cours: number, disponible: number, retiree: number, annulee: number},
 *   orders: Array<{id: number, status: string, total: number, pickupStart: string, dayOffset: number,
 *     customer: {firstName: string, lastName: string}}>,
 *   status: ?string, search: string, sort: string, page: number, pageCount: number,
 *   perPage: number, total: number}>}
 * @throws {ErreurApi} 401 si personne n'est connecté, 403 si le compte n'est
 *   pas administrateur.
 */
AdminData.fetchOrders = async function (query) {
  let params = new URLSearchParams({ page: String(query.page) });
  if (query.status !== null) params.set("status", query.status);
  if (query.search !== "") params.set("q", query.search);
  if (query.sort !== null) params.set("sort", query.sort);

  return getRequest(`admin/orders?${params}`);
};

/**
 * Détail d'une commande : GET /api/admin/order?id=…
 *
 * @param {number} id
 * @returns {Promise<{order: {id: number, status: string, total: number, pickupStart: string,
 *   pickupEnd: string, createdAt: string, dayOffset: number,
 *   dealership: {id: number, name: string, shortName: string},
 *   lines: Array<{variantId: ?number, name: string, label: string, reference: string,
 *     unitPrice: number, quantity: number, options: Array<{label: string, price: number}>}>,
 *   customer: {firstName: string, lastName: string, phone: string},
 *   events: Array<{status: string, createdAt: string, admin: ?{firstName: string, lastName: string}}>}}>}
 * @throws {ErreurApi} 404 si la commande n'existe pas ; 401, 403 comme fetchOrders.
 */
AdminData.fetchOrder = async function (id) {
  return getRequest(`admin/order?id=${encodeURIComponent(id)}`);
};

/**
 * Passage de commandes à « disponible » ou « retirée » :
 * POST /api/admin/orders/status. Le serveur ne change que les commandes dont
 * le statut actuel le permet.
 *
 * @param {number[]} ids
 * @param {"disponible"|"retiree"} status
 * @returns {Promise<{status: string, updated: number[], skipped: number[]}>}
 * @throws {ErreurApi} 400 si la sélection ou le statut est invalide ; 401, 403
 *   comme fetchOrders.
 */
AdminData.updateOrderStatus = async function (ids, status) {
  return postRequest("admin/orders/status", { ids, status });
};

/**
 * Annulation d'une commande, avec recrédit du stock :
 * POST /api/admin/orders/cancel.
 *
 * @param {number} id
 * @returns {Promise<{order: Object}>} La commande annulée, comme fetchOrder.
 * @throws {ErreurApi} 404 si la commande n'existe pas, 409 si elle est retirée
 *   ou déjà annulée ; 401, 403 comme fetchOrders.
 */
AdminData.cancelOrder = async function (id) {
  return postRequest("admin/orders/cancel", { id });
};

/**
 * Catégories, masquées comprises : GET /api/admin/categories
 *
 * @returns {Promise<{admin: {firstName: string, lastName: string},
 *   categories: Array<{id: number, parentId: null, name: string, slug: string, description: ?string,
 *     isVisible: boolean, productCount: number,
 *     children: Array<{id: number, parentId: number, name: string, slug: string, description: ?string,
 *       isVisible: boolean, productCount: number}>}>}>}
 *   productCount compte tous les produits, sous-catégories comprises.
 * @throws {ErreurApi} 401 si personne n'est connecté, 403 si le compte n'est
 *   pas administrateur.
 */
AdminData.fetchCategories = async function () {
  return getRequest("admin/categories");
};

/**
 * Création d'une catégorie : POST /api/admin/categories
 *
 * @param {{name: string, description: string, isVisible: boolean, parentId: ?number}} category
 * @returns {Promise<{category: Object}>} La catégorie créée.
 * @throws {ErreurApi} 422 si la saisie est invalide, 409 si le nom est déjà
 *   pris (erreurs par champ dans champs) ; 401, 403 comme fetchCategories.
 */
AdminData.createCategory = async function (category) {
  return postRequest("admin/categories", category);
};

/**
 * Modification d'une catégorie : POST /api/admin/categories/update
 *
 * @param {number} id
 * @param {{name: string, description: string, isVisible: boolean, parentId: ?number}} category
 * @returns {Promise<{category: Object}>} La catégorie modifiée.
 * @throws {ErreurApi} 404 si la catégorie n'existe pas ; 422, 409, 401, 403
 *   comme createCategory.
 */
AdminData.updateCategory = async function (id, category) {
  return postRequest("admin/categories/update", { id, ...category });
};

/**
 * Suppression d'une catégorie vide : POST /api/admin/categories/delete
 *
 * @param {number} id
 * @returns {Promise<{deleted: {id: number, name: string}}>}
 * @throws {ErreurApi} 404 si la catégorie n'existe pas, 409 si elle contient
 *   encore des produits ou des sous-catégories ; 401, 403 comme fetchCategories.
 */
AdminData.deleteCategory = async function (id) {
  return postRequest("admin/categories/delete", { id });
};

/**
 * Liste des produits, en ligne ou non : GET /api/admin/products
 *
 * @returns {Promise<{admin: {firstName: string, lastName: string},
 *   products: Array<{id: number, name: string, price: number, image: ?string, isActive: boolean,
 *     category: string, variantCount: number, stock: number, minStock: number,
 *     lowStockThreshold: number}>}>}
 *   minStock est le stock de la variante la plus basse.
 * @throws {ErreurApi} 401 si personne n'est connecté, 403 si le compte n'est
 *   pas administrateur.
 */
AdminData.fetchProducts = async function () {
  return getRequest("admin/products");
};

/**
 * Fiche d'un produit au back-office : GET /api/admin/product?id=…, ou sans
 * id pour un nouveau produit (product vaut alors null).
 *
 * @param {?number} id
 * @returns {Promise<{admin: {firstName: string, lastName: string},
 *   product: ?{id: number, categoryId: number, name: string, description: ?string, price: number,
 *     image: ?string, variantAxis: ?string, lowStockThreshold: number, isActive: boolean,
 *     variants: Array<{id: number, label: string, reference: string, stock: number}>,
 *     options: Array<{id: number, label: string, description: ?string, price: number}>,
 *     movements: Array<{createdAt: string, reason: "commande"|"annulation"|"reassort"|"ajustement",
 *       quantity: number, stockAfter: number, orderId: ?number, label: string}>},
 *   categories: Array<{id: number, name: string, parentName: ?string, isVisible: boolean}>,
 *   images: string[]}>}
 * @throws {ErreurApi} 400 si l'identifiant est invalide, 404 si le produit
 *   n'existe pas ; 401, 403 comme fetchProducts.
 */
AdminData.fetchProduct = async function (id) {
  return getRequest(id === null ? "admin/product" : `admin/product?id=${encodeURIComponent(id)}`);
};

/**
 * Création d'un produit : POST /api/admin/products
 *
 * Prix, seuil et stocks sont envoyés tels que saisis (« 379,90 ») : le
 * serveur les valide.
 *
 * @param {{name: string, description: string, price: string, categoryId: ?number, image: ?string,
 *   variantAxis: string, lowStockThreshold: string, isActive: boolean,
 *   variants: Array<{id: null, label: string, reference: string, stock: string}>,
 *   options: Array<{id: null, label: string, description: string, price: string}>}} product
 * @returns {Promise<{product: Object}>} La fiche créée, comme fetchProduct.
 * @throws {ErreurApi} 422 si la saisie est invalide, 409 si une référence est
 *   déjà prise (erreurs par champ dans champs, « variants.0.reference »…) ;
 *   401, 403 comme fetchProducts.
 */
AdminData.createProduct = async function (product) {
  return postRequest("admin/products", product);
};

/**
 * Enregistrement d'un produit : POST /api/admin/products/update
 *
 * Chaque variante existante envoie previousStock, le stock affiché au
 * chargement : le serveur n'applique que l'écart saisi.
 *
 * @param {number} id
 * @param {Object} product - Comme createProduct, avec l'id et previousStock
 *   des variantes et options existantes.
 * @returns {Promise<{product: Object}>} La fiche enregistrée, comme fetchProduct.
 * @throws {ErreurApi} 404 si le produit n'existe pas ; 422, 409, 401, 403
 *   comme createProduct.
 */
AdminData.updateProduct = async function (id, product) {
  return postRequest("admin/products/update", { id, ...product });
};

/**
 * Suppression d'un produit : POST /api/admin/products/delete
 *
 * @param {number} id
 * @returns {Promise<{deleted: {id: number, name: string}}>}
 * @throws {ErreurApi} 404 si le produit n'existe pas, 409 s'il est dans une
 *   commande en cours ou disponible ; 401, 403 comme fetchProducts.
 */
AdminData.deleteProduct = async function (id) {
  return postRequest("admin/products/delete", { id });
};

/**
 * Statistiques : GET /api/admin/stats?period=…
 *
 * @param {"7"|"30"|"year"} period - Derniers 7 ou 30 jours, ou année en cours.
 * @returns {Promise<{admin: {firstName: string, lastName: string}, period: "7"|"30"|"year",
 *   stats: {revenue: number, previousRevenue: number, orderCount: number, previousOrderCount: number,
 *     inProgressCount: number, availableCount: number, cancelledCount: number},
 *   dailyRevenue: Array<{date: string, revenue: number, isClosed: boolean}>,
 *   bestSellers: Array<{name: string, quantity: number}>,
 *   stock: Array<{id: number, name: string, stock: number, lowStockThreshold: number}>,
 *   stockAlerts: Array<{variantId: number, productId: number, name: string, label: string, stock: number,
 *     lowStockThreshold: number}>,
 *   stockAlertCount: number}>}
 *   previous… : la période précédente de même durée (l'an dernier à la même
 *   date pour « year ») ; dailyRevenue : les 7 derniers jours, aujourd'hui en
 *   dernier ; stock : produits en ligne, du mieux fourni au moins fourni.
 * @throws {ErreurApi} 401 si personne n'est connecté, 403 si le compte n'est
 *   pas administrateur.
 */
AdminData.fetchStats = async function (period) {
  return getRequest(`admin/stats?period=${encodeURIComponent(period)}`);
};

/**
 * Codes promo : GET /api/admin/promo-codes
 *
 * @returns {Promise<{admin: {firstName: string, lastName: string},
 *   promoCodes: Array<{id: number, code: string, discountRate: number, minAmount: number,
 *     startsOn: ?string, endsOn: ?string, maxUses: ?number, useCount: number,
 *     status: "actif"|"programme"|"expire"|"epuise"}>}>}
 *   Du plus récent au plus ancien ; dates au format « 2026-12-31 », null
 *   sans borne ; maxUses null : illimité. Le statut est calculé par le
 *   serveur à la date du jour.
 * @throws {ErreurApi} 401 si personne n'est connecté, 403 si le compte n'est
 *   pas administrateur.
 */
AdminData.fetchPromoCodes = async function () {
  return getRequest("admin/promo-codes");
};

/**
 * Création d'un code promo : POST /api/admin/promo-codes
 *
 * Les valeurs sont envoyées telles que saisies (« 50,00 », « » pour
 * illimité) : le serveur les valide.
 *
 * @param {{code: string, discountRate: string, minAmount: string, startsOn: string, endsOn: string,
 *   maxUses: string}} promoCode
 * @returns {Promise<{promoCode: Object}>} Le code créé, comme dans fetchPromoCodes.
 * @throws {ErreurApi} 422 si la saisie est invalide, 409 si le code existe
 *   déjà (erreurs par champ dans champs) ; 401, 403 comme fetchPromoCodes.
 */
AdminData.createPromoCode = async function (promoCode) {
  return postRequest("admin/promo-codes", promoCode);
};

/**
 * Modification d'un code promo : POST /api/admin/promo-codes/update
 *
 * @param {number} id
 * @param {Object} promoCode - Comme createPromoCode.
 * @returns {Promise<{promoCode: Object}>} Le code modifié.
 * @throws {ErreurApi} 404 si le code n'existe pas ; 422, 409, 401, 403
 *   comme createPromoCode.
 */
AdminData.updatePromoCode = async function (id, promoCode) {
  return postRequest("admin/promo-codes/update", { id, ...promoCode });
};

/**
 * Suppression d'un code promo : POST /api/admin/promo-codes/delete
 *
 * @param {number} id
 * @returns {Promise<{deleted: {id: number, code: string}}>}
 * @throws {ErreurApi} 404 si le code n'existe pas ; 401, 403 comme fetchPromoCodes.
 */
AdminData.deletePromoCode = async function (id) {
  return postRequest("admin/promo-codes/delete", { id });
};

export { AdminData };
