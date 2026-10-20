import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { CategoryMenuView } from "../category-menu/index.js";
import template from "./template.html?raw";

// En-tête de la charte Honda : logo, navigation, recherche, compte et panier.
// Il reçoit le menu des catégories déjà préparé (DEC-a) et signale le clic sur
// « Catégories » par actions.onToggleMenu. Il reçoit aussi le nombre
// d'articles du panier (CMD-b), que le layout tient à jour dans
// [data-cart-count].
let HeaderView = {
  /**
   * @param {number} cartCount - Nombre d'articles du panier.
   * @returns {string} Le HTML de l'en-tête, sans le menu des catégories
   *   (slot « category-menu »).
   */
  html: function (cartCount) {
    return genericRenderer(template, { cartCount });
  },

  /**
   * @param {Parameters<typeof CategoryMenuView.dom>[0]} menu - Menu des catégories.
   * @param {number} cartCount - Nombre d'articles du panier.
   * @param {{onToggleMenu: () => void}} actions
   * @returns {DocumentFragment} L'en-tête, prêt à être inséré.
   */
  dom: function (menu, cartCount, actions) {
    let fragment = htmlToFragment(HeaderView.html(cartCount));
    fragment.querySelector('slot[name="category-menu"]').replaceWith(HeaderView.menu(menu));
    fragment.querySelector("[data-category-menu-button]").addEventListener("click", () => actions.onToggleMenu());
    return fragment;
  },

  /**
   * @param {Parameters<typeof CategoryMenuView.dom>[0]} menu - Menu des catégories.
   * @returns {DocumentFragment} Le panneau du menu seul, fermé : pour le
   *   remplacer quand les catégories arrivent.
   */
  menu: function (menu) {
    return CategoryMenuView.dom(menu);
  },
};

export { HeaderView };
