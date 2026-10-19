import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateItem from "./item.html?raw";

// Colonne « Catégories » de la page catégorie. Le composant ne décide de rien :
// il reçoit les entrées déjà préparées (adresse, nombre, entrée en cours).
// Ce sont des liens data-link : le routeur gère la navigation.
let CategoryNavView = {
  /**
   * @param {Array<{label: string, url: string, count: number, countLabel: string,
   *   isActive: boolean}>} items
   * @returns {DocumentFragment}
   */
  dom: function (items) {
    let fragment = htmlToFragment(template);

    let rows = items.map((item) => {
      let row = htmlToFragment(genericRenderer(templateItem, item));
      // Un template n'a pas de condition : l'entrée en cours se règle ici.
      row.querySelector("a").dataset.active = String(item.isActive);
      return row;
    });
    fragment.querySelector('slot[name="items"]').replaceWith(...rows);

    return fragment;
  },
};

export { CategoryNavView };
