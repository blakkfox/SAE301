import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { QuantityStepperView } from "../quantity-stepper/index.js";
import { StockBadgeView } from "../stock-badge/index.js";
import template from "./template.html?raw";
import templateImage from "./image.html?raw";
import templatePlaceholder from "./placeholder.html?raw";

// Classes d'une ligne disponible ou épuisée (écran 8, STK-c), écrites en
// entier. Le nom et le prix d'un article épuisé restent en gris secondaire :
// le gris Texte/Désactivé de la maquette est trop peu contrasté.
const TONES = {
  available: {
    visualClasses: "",
    nameClasses: "text-ink",
    priceClasses: "text-ink",
    removeClasses: "text-sm text-ink-muted",
  },
  soldOut: {
    visualClasses: "opacity-45",
    nameClasses: "text-ink-muted",
    priceClasses: "text-ink-muted",
    removeClasses: "text-small font-semibold text-accent",
  },
};

// Ligne du panier, telle que la prépare le modèle de la page : les prix sont
// déjà mis en forme, le statut de stock déjà calculé. stockNote vaut le texte
// « Quantité ajustée… » ou null. Le composant signale le changement de
// quantité et le retrait de la ligne par actions.onQuantity et actions.onRemove.
let CartLineView = {
  /**
   * @param {{variantId: number, productId: number, name: string, label: string,
   *   details: string, imageUrl: ?string, quantity: number, maxQuantity: number,
   *   total: string, stockStatus: "in"|"low"|"out", isSoldOut: boolean,
   *   stockNote: ?string}} line
   * @param {{onQuantity: (variantId: number, quantity: number) => void,
   *   onRemove: (variantId: number) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (line, actions) {
    let tone = line.isSoldOut ? TONES.soldOut : TONES.available;
    let fragment = htmlToFragment(genericRenderer(template, { ...line, ...tone, stockNote: line.stockNote ?? "" }));

    fragment.querySelector('slot[name="visual"]').replaceWith(CartLineView.visual(line.imageUrl));
    fragment.querySelector('slot[name="stock"]').replaceWith(StockBadgeView.dom(line.stockStatus));

    if (line.stockNote === null) {
      fragment.querySelector("[data-stock-note]").remove();
    }

    let state = "default";
    if (line.isSoldOut) {
      state = "disabled";
    } else if (line.stockNote !== null) {
      state = "warning";
    }

    let stepper = QuantityStepperView.dom(
      {
        quantity: line.quantity,
        min: 1,
        max: line.maxQuantity,
        label: `Quantité de ${line.name} (${line.label})`,
        size: "small",
        state,
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
