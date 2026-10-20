import { htmlToFragment } from "../../lib/utils.js";
import { ProductCardView } from "../product-card/index.js";
import template from "./template.html?raw";
import templateEmpty from "./empty.html?raw";
import templateLoading from "./loading.html?raw";

// Grille de cartes produit. Elle compose ProductCardView : les cartes prennent
// la place du <slot name="cards">. Sa zone [data-grid-status] annonce l'ajout
// au panier depuis une carte.
let ProductGridView = {
  /**
   * @param {Array<Parameters<typeof ProductCardView.dom>[0]>} products
   * @param {2|3} headingLevel - Niveau du titre des cartes (h2 ou h3).
   * @param {Parameters<typeof ProductCardView.dom>[2]} actions
   * @returns {DocumentFragment} La grille, ou le message « catalogue vide ».
   */
  dom: function (products, headingLevel, actions) {
    if (products.length === 0) {
      return htmlToFragment(templateEmpty);
    }

    let fragment = htmlToFragment(template);
    let cards = products.map((product) => ProductCardView.dom(product, headingLevel, actions));
    fragment.querySelector('slot[name="cards"]').replaceWith(...cards);
    return fragment;
  },

  /**
   * @returns {DocumentFragment} Le squelette affiché pendant le chargement.
   */
  loading: function () {
    return htmlToFragment(templateLoading);
  },
};

export { ProductGridView };
