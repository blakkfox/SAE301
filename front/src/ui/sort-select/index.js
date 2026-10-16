import { htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Choix du tri du catalogue. Le composant ne décide de rien : il affiche le
// tri reçu, et signale le nouveau choix par actions.onSort.
let SortSelectView = {
  /**
   * @param {{sort: string, disabled: boolean}} data - Tri appliqué ; disabled
   *   pendant un chargement, pour ne pas empiler les requêtes.
   * @param {{onSort: (sort: string) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(template);
    let select = fragment.querySelector('select[name="sort"]');

    // Un template n'a pas de condition : l'option choisie se règle ici.
    select.value = data.sort;
    select.disabled = data.disabled;

    select.addEventListener("change", (ev) => actions.onSort(ev.target.value));

    return fragment;
  },
};

export { SortSelectView };
