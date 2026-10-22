/**
 * Statut de stock affiché (US STK-b), d'après la légende de la maquette :
 * « En stock » au-delà du seuil du produit, « Bientôt épuisé » de 1 au
 * seuil, « Épuisé » à 0.
 *
 * Le seuil est propre à chaque produit (lowStockThreshold de l'API, réglé au
 * back-office, US GOF-a) ; LOW_STOCK_MAX est sa valeur par défaut.
 *
 * Seul l'affichage dépend de ce calcul : le serveur revérifie le stock à la
 * commande (CMD-a).
 */

// Seuil « Bientôt épuisé » d'un produit qui n'en précise pas (DEFAULT de la colonne).
export const LOW_STOCK_MAX = 3;

/**
 * @param {number} stock - Unités disponibles, lues dans l'API.
 * @param {number} [threshold=LOW_STOCK_MAX] - Seuil « Bientôt épuisé » du produit.
 * @returns {"in"|"low"|"out"} Le statut à afficher.
 */
export function getStockStatus(stock, threshold = LOW_STOCK_MAX) {
  if (stock <= 0) return "out";
  if (stock <= threshold) return "low";
  return "in";
}
