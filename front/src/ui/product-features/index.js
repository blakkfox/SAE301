import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateRow from "./row.html?raw";

// Bloc « Caractéristiques » de la fiche produit.
// Un template par élément répété : chaque ligne a le sien (row.html).
let ProductFeaturesView = {
  /**
   * @param {Array<{label: string, value: string}>} features
   * @returns {DocumentFragment} Le bloc, ou un fragment vide si le produit
   *   n'a aucune caractéristique.
   */
  dom: function (features) {
    if (features.length === 0) {
      return htmlToFragment("");
    }

    let fragment = htmlToFragment(template);
    let rows = features.map((feature) => htmlToFragment(genericRenderer(templateRow, feature)));
    fragment.querySelector('slot[name="rows"]').replaceWith(...rows);
    return fragment;
  },
};

export { ProductFeaturesView };
