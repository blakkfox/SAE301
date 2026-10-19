import { htmlToFragment } from "../../lib/utils.js";
import { ProductCardView } from "../product-card/index.js";
import template from "./template.html?raw";
import templateEmpty from "./empty.html?raw";
import templateLoading from "./loading.html?raw";

// Grille de cartes produit. Elle compose ProductCardView : les cartes prennent
// la place du <slot name="cards">.
let ProductGridView = {
  /**
   * @param {Array<{id: number, name: string, price: number, imageUrl: ?string}>} products
   * @param {2|3} [headingLevel=2] - Niveau du titre des cartes (h2 ou h3).
   * @returns {DocumentFragment} La grille, ou le message « catalogue vide ».
   */
  dom: function (products, headingLevel = 2) {
    if (products.length === 0) {
      return htmlToFragment(templateEmpty);
    }

    let fragment = htmlToFragment(template);
    let cards = products.map((product) => ProductCardView.dom(product, headingLevel));
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
