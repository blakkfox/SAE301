import { htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// En-tête de la charte Honda : logo, navigation, recherche, compte et panier.
// Composant sans données pour l'instant : le nombre d'articles du panier
// (data-cart-count) sera fourni par CMD-b.
let HeaderView = {
  /**
   * @returns {string} Le HTML de l'en-tête.
   */
  html: function () {
    return template;
  },

  /**
   * @returns {DocumentFragment} L'en-tête, prêt à être inséré.
   */
  dom: function () {
    return htmlToFragment(template);
  },
};

export { HeaderView };
