import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { AccountDropdownView } from "../account-dropdown/index.js";
import { CategoryMenuView } from "../category-menu/index.js";
import template from "./template.html?raw";

// En-tête de la charte Honda : logo, navigation, recherche, compte et panier.
// Il reçoit le menu des catégories déjà préparé (DEC-a) et signale le clic sur
// « Catégories » par actions.onToggleMenu. Il reçoit aussi le nombre
// d'articles du panier (CMD-b), que le layout tient à jour dans
// [data-cart-count], et le compte connecté (SUI-b), dont le menu déroulant
// signale ses clics par actions.onToggleAccount et actions.onLogout. La
// recherche envoyée est signalée par actions.onSearch, avec le texte saisi.
let HeaderView = {
  /**
   * @param {number} cartCount - Nombre d'articles du panier.
   * @param {string} search - Recherche en cours, affichée dans le champ.
   * @returns {string} Le HTML de l'en-tête, sans le menu des catégories
   *   (slot « category-menu ») ni le compte (slot « account »).
   */
  html: function (cartCount, search) {
    return genericRenderer(template, { cartCount, search });
  },

  /**
   * @param {Parameters<typeof CategoryMenuView.dom>[0]} menu - Menu des catégories.
   * @param {number} cartCount - Nombre d'articles du panier.
   * @param {Parameters<typeof AccountDropdownView.dom>[0]} account - Compte connecté.
   * @param {string} search - Recherche en cours, affichée dans le champ.
   * @param {{onToggleMenu: () => void, onToggleAccount: () => void, onLogout: () => void,
   *   onSearch: (search: string) => void}} actions
   * @returns {DocumentFragment} L'en-tête, prêt à être inséré.
   */
  dom: function (menu, cartCount, account, search, actions) {
    let fragment = htmlToFragment(HeaderView.html(cartCount, search));
    fragment.querySelector('slot[name="category-menu"]').replaceWith(HeaderView.menu(menu));
    fragment.querySelector('slot[name="account"]').replaceWith(HeaderView.account(account, actions));
    fragment.querySelector("[data-category-menu-button]").addEventListener("click", () => actions.onToggleMenu());

    let form = fragment.querySelector("[data-search-form]");
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      actions.onSearch(form.elements.namedItem("q").value);
    });
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

  /**
   * @param {Parameters<typeof AccountDropdownView.dom>[0]} account - Compte connecté.
   * @param {{onToggleAccount: () => void, onLogout: () => void}} actions
   * @returns {DocumentFragment} Le compte seul : pour le remplacer quand il change.
   */
  account: function (account, actions) {
    return AccountDropdownView.dom(account, { onToggle: actions.onToggleAccount, onLogout: actions.onLogout });
  },
};

export { HeaderView };
