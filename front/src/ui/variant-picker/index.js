import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateOption from "./option.html?raw";

// Choix de la variante d'un produit. Le composant reçoit les variantes déjà
// préparées (laquelle est choisie) et signale le choix par actions.onSelect.
let VariantPickerView = {
  /**
   * @param {{selectedLabel: string,
   *   options: Array<{id: number, label: string, isSelected: boolean}>}} data
   * @param {{onSelect: (variantId: number) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(genericRenderer(template, { selectedLabel: data.selectedLabel }));

    let options = data.options.map((option) => {
      let item = htmlToFragment(genericRenderer(templateOption, option));
      // Un template n'a pas de condition : la sélection se règle ici.
      item.querySelector("input").checked = option.isSelected;
      return item;
    });
    fragment.querySelector('slot[name="options"]').replaceWith(...options);

    // Délégation : un seul écouteur pour tous les boutons radio.
    fragment.querySelector("fieldset").addEventListener("change", (ev) => {
      actions.onSelect(Number(ev.target.value));
    });

    return fragment;
  },
};

export { VariantPickerView };
