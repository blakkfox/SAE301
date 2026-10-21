import { htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Case « Masquer les produits épuisés » du catalogue (STK-b). Le composant
// affiche l'état reçu et signale le nouveau choix par actions.onToggle.
// Elle reste active pendant un chargement : la page ne retient que la réponse
// de la dernière requête, et le focus clavier n'est pas perdu.
let SoldOutToggleView = {
  /**
   * @param {{checked: boolean}} data
   * @param {{onToggle: (hideSoldOut: boolean) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(template);
    let checkbox = fragment.querySelector('input[name="hideSoldOut"]');

    // Un template n'a pas de condition : l'état se règle ici.
    checkbox.checked = data.checked;

    checkbox.addEventListener("change", (ev) => actions.onToggle(ev.target.checked));

    return fragment;
  },
};

export { SoldOutToggleView };
