import { htmlToFragment } from "../../lib/utils.js";
import { CategoryMenuView } from "../category-menu/index.js";
import template from "./template.html?raw";

// En-tête de la charte Honda : logo, navigation, recherche, compte et panier.
// Il reçoit le menu des catégories déjà préparé (DEC-a) et signale le clic sur
// « Catégories » par actions.onToggleMenu. Le nombre d'articles du panier
// (data-cart-count) sera fourni par CMD-b.
let HeaderView = {
  /**
   * @returns {string} Le HTML de l'en-tête, sans le menu des catégories
   *   (slot « category-menu »).
   */
  html: function () {
    return template;
  },

  /**
   * @param {Parameters<typeof CategoryMenuView.dom>[0]} menu - Menu des catégories.
   * @param {{onToggleMenu: () => void}} actions
   * @returns {DocumentFragment} L'en-tête, prêt à être inséré.
   */
  dom: function (menu, actions) {
    let fragment = htmlToFragment(template);
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
