/**
 * Petites fonctions de mise en forme, sans dépendance.
 */

// Créé une seule fois : construire un Intl.NumberFormat est coûteux.
const PRICE_FORMAT = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/**
 * Met un prix en forme à la française.
 *
 * Intl sépare le nombre et « € » par une espace insécable : le symbole ne
 * passe jamais seul à la ligne.
 *
 * @param {number} price - Prix en euros, par exemple 6.9.
 * @returns {string} Le prix affichable, par exemple « 6,90 € ».
 */
export function formatPrice(price) {
  return PRICE_FORMAT.format(price);
}
