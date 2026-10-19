import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateChip from "./chip.html?raw";

// Pastilles des sous-catégories de la page catégorie. Comme CategoryNavView,
// le composant reçoit les pastilles déjà préparées.
let CategoryChipsView = {
  /**
   * @param {Array<{label: string, url: string, count: number, countLabel: string,
   *   isActive: boolean}>} chips
   * @returns {DocumentFragment} Les pastilles, ou un fragment vide si la
   *   catégorie n'a pas de sous-catégorie.
   */
  dom: function (chips) {
    if (chips.length === 0) {
      return htmlToFragment("");
    }

    let fragment = htmlToFragment(template);

    let items = chips.map((chip) => {
      let item = htmlToFragment(genericRenderer(templateChip, chip));
      // Un template n'a pas de condition : la pastille en cours se règle ici.
      item.querySelector("a").dataset.active = String(chip.isActive);
      return item;
    });
    fragment.querySelector('slot[name="chips"]').replaceWith(...items);

    return fragment;
  },
};

export { CategoryChipsView };
