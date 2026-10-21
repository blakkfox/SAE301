/**
 * Statut de stock affiché (US STK-b), d'après la légende de la maquette :
 * « En stock » au-delà de LOW_STOCK_MAX unités, « Bientôt épuisé » de 1 à
 * LOW_STOCK_MAX, « Épuisé » à 0.
 *
 * Seul l'affichage dépend de ce calcul : le serveur revérifie le stock à la
 * commande (CMD-a).
 */

// Nombre d'unités jusqu'auquel un article est « Bientôt épuisé ».
export const LOW_STOCK_MAX = 3;

/**
 * @param {number} stock - Unités disponibles, lues dans l'API.
 * @returns {"in"|"low"|"out"} Le statut à afficher.
 */
export function getStockStatus(stock) {
  if (stock <= 0) return "out";
  if (stock <= LOW_STOCK_MAX) return "low";
  return "in";
}
