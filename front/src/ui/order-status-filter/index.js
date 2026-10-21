import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateChip from "./chip.html?raw";

// Pastilles de filtre de la gestion des commandes (US PIL-b) : « Toutes »,
// puis une par statut, avec leur nombre. Le composant reçoit les pastilles
// déjà préparées et signale le choix par actions.onChange.
let OrderStatusFilterView = {
  /**
   * @param {Array<{status: ?string, label: string, count: number, countLabel: string,
   *   isActive: boolean}>} chips - status vaut null pour « Toutes ».
   * @param {{onChange: (status: ?string) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (chips, actions) {
    let fragment = htmlToFragment(template);

    let items = chips.map((chip) => {
      let item = htmlToFragment(
        genericRenderer(templateChip, {
          status: chip.status ?? "",
          label: chip.label,
          count: chip.count,
          countLabel: chip.countLabel,
        }),
      );
      // Un template n'a pas de condition : la pastille choisie se règle ici.
      item.querySelector("button").setAttribute("aria-pressed", String(chip.isActive));
      return item;
    });
    fragment.querySelector('slot[name="chips"]').replaceWith(...items);

    // Délégation : un seul écouteur pour toutes les pastilles.
    fragment.querySelector("ul").addEventListener("click", (ev) => {
      let button = ev.target.closest("button[data-status]");
      if (button === null || button.getAttribute("aria-pressed") === "true") return;
      actions.onChange(button.dataset.status === "" ? null : button.dataset.status);
    });

    return fragment;
  },
};

export { OrderStatusFilterView };
