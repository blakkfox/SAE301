import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Dimensions des deux maquettes. Classes écrites en entier : Tailwind ne
// génère que les classes qu'il trouve telles quelles dans le code.
const SIZES = {
  large: "h-13 w-33", // fiche produit (écran 2)
  small: "h-11 w-30", // ligne du panier (écran 4)
};

// Sélecteur de quantité « − n + ». Le composant ne décide de rien : il reçoit
// la quantité et ses bornes, et signale la nouvelle quantité demandée par
// actions.onChange. C'est la page qui l'accepte (ou non) et réaffiche.
let QuantityStepperView = {
  /**
   * @param {{quantity: number, min: number, max: number, label: string,
   *   size: "large"|"small"}} data - label : nom accessible du groupe,
   *   par exemple « Quantité de Blouson cuir Maine ».
   * @param {{onChange: (quantity: number) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(
      genericRenderer(template, { quantity: data.quantity, label: data.label, sizeClasses: SIZES[data.size] })
    );

    fragment.querySelector('[data-step="-1"]').disabled = data.quantity <= data.min;
    fragment.querySelector('[data-step="1"]').disabled = data.quantity >= data.max;

    // Délégation : un seul écouteur pour les deux boutons.
    fragment.firstElementChild.addEventListener("click", (ev) => {
      let button = ev.target.closest("button[data-step]");
      if (button === null) return;
      actions.onChange(data.quantity + Number(button.dataset.step));
    });

    return fragment;
  },
};

export { QuantityStepperView };
