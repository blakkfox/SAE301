import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { QuantityStepperView } from "../quantity-stepper/index.js";
import template from "./template.html?raw";
import templateImage from "./image.html?raw";
import templatePlaceholder from "./placeholder.html?raw";

// Ligne du panier, telle que la prépare le modèle de la page : les prix sont
// déjà mis en forme. Le composant signale le changement de quantité et le
// retrait de la ligne par actions.onQuantity et actions.onRemove.
let CartLineView = {
  /**
   * @param {{variantId: number, productId: number, name: string, label: string,
   *   details: string, imageUrl: ?string, quantity: number, maxQuantity: number,
   *   total: string}} line
   * @param {{onQuantity: (variantId: number, quantity: number) => void,
   *   onRemove: (variantId: number) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (line, actions) {
    let fragment = htmlToFragment(genericRenderer(template, line));

    fragment.querySelector('slot[name="visual"]').replaceWith(CartLineView.visual(line.imageUrl));

    let stepper = QuantityStepperView.dom(
      {
        quantity: line.quantity,
        min: 1,
        max: line.maxQuantity,
        label: `Quantité de ${line.name} (${line.label})`,
        size: "small",
      },
      { onChange: (quantity) => actions.onQuantity(line.variantId, quantity) }
    );
    fragment.querySelector('slot[name="quantity"]').replaceWith(stepper);

    fragment.querySelector("[data-remove]").addEventListener("click", () => actions.onRemove(line.variantId));

    return fragment;
  },

  /**
   * @param {?string} imageUrl - Adresse de la photo, ou null.
   * @returns {DocumentFragment} La photo, ou son remplaçant.
   */
  visual: function (imageUrl) {
    if (imageUrl === null) {
      return htmlToFragment(templatePlaceholder);
    }

    let fragment = htmlToFragment(genericRenderer(templateImage, { imageUrl }));
    let image = fragment.querySelector("img");

    // Fichier absent ou illisible : remplaçant plutôt qu'une image cassée.
    image.addEventListener("error", () => {
      image.parentElement.replaceWith(CartLineView.visual(null));
    });

    return fragment;
  },
};

export { CartLineView };
