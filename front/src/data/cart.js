import { getRequest } from "../lib/api-request.js";

/**
 * Panier (US CMD-b), gardé dans le localStorage du navigateur.
 *
 * Le panier ne contient que des identifiants de variantes, des quantités et
 * les options cochées de chaque ligne (US OPT-a) :
 * [{ variantId: 12, quantity: 2, optionIds: [1, 2] }, …]. Une ligne par
 * variante : ses options valent pour toute sa quantité. Le nom, la photo et
 * surtout les prix et suppléments sont toujours redemandés à l'API
 * (fetchVariants) : une valeur modifiée à la main dans le navigateur ne peut
 * donc pas changer un prix.
 *
 * Le localStorage peut être indisponible (navigation privée, stockage bloqué)
 * ou contenir une valeur abîmée : chaque lecture et écriture est protégée, et
 * le panier est alors simplement vide.
 *
 * Plusieurs parties de l'application affichent le panier (le compteur de
 * l'en-tête, la page Panier) : subscribe permet d'être prévenu de chaque
 * modification.
 */

const STORAGE_KEY = "honda-cart";

// Quantité maximale d'une ligne, quel que soit le stock. Le stock réel la
// réduit encore (remainingFor, page Panier : STK-c) ; le serveur revérifie
// tout à la validation (CMD-a).
const MAX_QUANTITY = 10;

// Nombre maximal d'options d'une ligne (comme MAX_OPTIONS côté serveur).
const MAX_OPTIONS = 10;

// Fonctions à appeler après chaque modification du panier.
const listeners = [];

let CartData = {
  MAX_QUANTITY,
};

/**
 * @param {*} item - Valeur lue dans le stockage.
 * @returns {boolean} true si c'est une ligne de panier exploitable.
 */
let isValidItem = function (item) {
  return (
    item !== null &&
    typeof item === "object" &&
    Number.isInteger(item.variantId) &&
    item.variantId > 0 &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= MAX_QUANTITY
  );
};

/**
 * Options d'une ligne lue dans le stockage. Un panier enregistré avant
 * OPT-a n'en a pas : la ligne est alors sans option. Les identifiants
 * invalides ou en double sont écartés.
 *
 * @param {*} optionIds - Valeur lue dans le stockage.
 * @returns {number[]}
 */
let toOptionIds = function (optionIds) {
  if (!Array.isArray(optionIds)) return [];

  return optionIds
    .filter((id, index) => Number.isInteger(id) && id > 0 && optionIds.indexOf(id) === index)
    .slice(0, MAX_OPTIONS);
};

/**
 * Les lignes du panier. Une valeur abîmée ou un stockage indisponible donne
 * un panier vide ; une ligne invalide est ignorée.
 *
 * @returns {Array<{variantId: number, quantity: number, optionIds: number[]}>}
 */
CartData.read = function () {
  try {
    let items = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(items)) return [];

    return items.filter(isValidItem).map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      optionIds: toOptionIds(item.optionIds),
    }));
  } catch (error) {
    return [];
  }
};

/**
 * Enregistre les lignes du panier, puis prévient les abonnés.
 *
 * @param {Array<{variantId: number, quantity: number, optionIds: number[]}>} items
 * @returns {boolean} false si le stockage a refusé l'écriture.
 */
CartData.write = function (items) {
  let isSaved = true;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    isSaved = false;
  }

  CartData.notify();
  return isSaved;
};

/**
 * Ajoute une quantité d'une variante. Si la variante est déjà dans le panier,
 * les quantités s'additionnent, dans la limite de MAX_QUANTITY.
 *
 * Options (US OPT-a) : une liste reçue remplace celles de la ligne (choix
 * fait sur la fiche produit) ; sans liste, la ligne garde les siennes
 * (ajout depuis une carte du catalogue, ou « Commander à nouveau »).
 *
 * @param {number} variantId
 * @param {number} quantity - Quantité à ajouter (au moins 1).
 * @param {number[]} [optionIds] - Options cochées, ou rien pour garder celles de la ligne.
 * @returns {boolean} false si le panier n'a pas pu être enregistré.
 */
CartData.add = function (variantId, quantity, optionIds) {
  let items = CartData.read();
  let existing = items.find((item) => item.variantId === variantId);

  if (existing === undefined) {
    items.push({ variantId, quantity: Math.min(quantity, MAX_QUANTITY), optionIds: toOptionIds(optionIds) });
  } else {
    existing.quantity = Math.min(existing.quantity + quantity, MAX_QUANTITY);
    if (optionIds !== undefined) {
      existing.optionIds = toOptionIds(optionIds);
    }
  }

  return CartData.write(items);
};

/**
 * Change la quantité d'une ligne (bornée entre 1 et MAX_QUANTITY). Ses
 * options ne changent pas.
 *
 * @param {number} variantId
 * @param {number} quantity
 * @returns {boolean} false si le panier n'a pas pu être enregistré.
 */
CartData.setQuantity = function (variantId, quantity) {
  let bounded = Math.min(Math.max(quantity, 1), MAX_QUANTITY);
  let items = CartData.read().map((item) => (item.variantId === variantId ? { ...item, quantity: bounded } : item));
  return CartData.write(items);
};

/**
 * Remplace les options d'une ligne (US OPT-a). Le serveur vérifie à la
 * commande que chacune appartient bien au produit.
 *
 * @param {number} variantId
 * @param {number[]} optionIds - Options cochées.
 * @returns {boolean} false si le panier n'a pas pu être enregistré.
 */
CartData.setOptions = function (variantId, optionIds) {
  let items = CartData.read().map((item) =>
    item.variantId === variantId ? { ...item, optionIds: toOptionIds(optionIds) } : item
  );
  return CartData.write(items);
};

/**
 * Retire des lignes les options que l'API ne propose plus pour leur produit
 * (option supprimée depuis l'ajout), et range les autres dans l'ordre
 * d'affichage du produit (US OPT-a). Le panier n'est réécrit que si une
 * option a été retirée.
 *
 * @param {Array<{variantId: number, options: Array<{id: number}>}>} variants - Réponse de fetchVariants.
 * @returns {{removed: number, isSaved: boolean}} Nombre d'options retirées, et
 *   false si le panier n'a pas pu être enregistré.
 */
CartData.keepOfferedOptions = function (variants) {
  let removed = 0;

  let items = CartData.read().map((item) => {
    let variant = variants.find((candidate) => candidate.variantId === item.variantId);
    if (variant === undefined) return item;

    let optionIds = variant.options.map((option) => option.id).filter((id) => item.optionIds.includes(id));
    removed += item.optionIds.length - optionIds.length;
    return { ...item, optionIds };
  });

  return { removed, isSaved: removed === 0 || CartData.write(items) };
};

/**
 * @param {number} variantId
 * @returns {number[]} Options cochées pour cette variante (vide si elle n'est pas au panier).
 */
CartData.optionsOf = function (variantId) {
  return CartData.read().find((item) => item.variantId === variantId)?.optionIds ?? [];
};

/**
 * Retire des lignes du panier.
 *
 * @param {number[]} variantIds - Variantes à retirer.
 * @returns {boolean} false si le panier n'a pas pu être enregistré.
 */
CartData.remove = function (variantIds) {
  let items = CartData.read().filter((item) => !variantIds.includes(item.variantId));
  return CartData.write(items);
};

/**
 * Vide le panier (commande enregistrée, CMD-a).
 *
 * @returns {boolean} false si le panier n'a pas pu être enregistré.
 */
CartData.clear = function () {
  return CartData.write([]);
};

/**
 * @param {number} variantId
 * @returns {number} Quantité de cette variante déjà dans le panier (0 si absente).
 */
CartData.quantityOf = function (variantId) {
  return CartData.read().find((item) => item.variantId === variantId)?.quantity ?? 0;
};

/**
 * Quantité de cette variante qu'on peut encore ajouter (US STK-c) : le stock,
 * dans la limite de MAX_QUANTITY, moins ce qui est déjà dans le panier.
 *
 * @param {number} variantId
 * @param {number} stock - Stock de la variante, lu dans l'API.
 * @returns {number} 0 si plus rien ne peut être ajouté.
 */
CartData.remainingFor = function (variantId, stock) {
  return Math.max(0, Math.min(stock, MAX_QUANTITY) - CartData.quantityOf(variantId));
};

/**
 * @returns {number} Nombre d'articles du panier (somme des quantités).
 */
CartData.count = function () {
  return CartData.read().reduce((total, item) => total + item.quantity, 0);
};

/**
 * Enregistre une fonction appelée après chaque modification du panier.
 *
 * @param {() => void} listener
 */
CartData.subscribe = function (listener) {
  listeners.push(listener);
};

/**
 * Prévient les abonnés que le panier a changé (y compris depuis un autre
 * onglet : voir le layout, qui écoute l'événement « storage »).
 */
CartData.notify = function () {
  for (const listener of listeners) {
    listener();
  }
};

/**
 * Nom, photo, prix et stock des variantes du panier, et options proposées
 * pour leur produit (US OPT-a) : GET /api/cart?variants=…
 *
 * Une variante absente de la réponse n'est plus au catalogue.
 *
 * @param {number[]} variantIds
 * @returns {Promise<{variants: Array<{variantId: number, label: string, reference: string,
 *   productId: number, name: string, price: number, image: ?string, stock: number,
 *   lowStockThreshold: number,
 *   options: Array<{id: number, label: string, description: ?string, price: number}>}>}>}
 * @throws {ErreurApi} Si le serveur répond par une erreur.
 */
CartData.fetchVariants = async function (variantIds) {
  return getRequest(`cart?variants=${encodeURIComponent(variantIds.join(","))}`);
};

export { CartData };
