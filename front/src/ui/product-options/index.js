import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateOption from "./option.html?raw";

// Bloc « Options » de la fiche produit (OPT-c). Le composant reçoit les
// options déjà préparées (libellés, suppléments formatés, lesquelles sont
// cochées) et signale chaque case cochée ou décochée par actions.onToggle.
let ProductOptionsView = {
  /**
   * @param {{total: string,
   *   options: Array<{id: number, label: string, description: string, price: string,
   *     isSelected: boolean}>}} data
   * @param {{onToggle: (optionId: number, isSelected: boolean) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(genericRenderer(template, { total: data.total }));

    let options = data.options.map((option) => {
      let item = htmlToFragment(
        genericRenderer(templateOption, {
          id: option.id,
          label: option.label,
          description: option.description,
          price: option.price,
        })
      );
      // Un template n'a pas de condition : la case cochée se règle ici.
      item.querySelector("input").checked = option.isSelected;
      return item;
    });
    fragment.querySelector('slot[name="options"]').replaceWith(...options);

    // Délégation : un seul écouteur pour toutes les cases.
    fragment.querySelector("fieldset").addEventListener("change", (ev) => {
      actions.onToggle(Number(ev.target.value), ev.target.checked);
    });

    return fragment;
  },
};

export { ProductOptionsView };
