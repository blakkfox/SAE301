import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { ProductOptionsView } from "../product-options/index.js";
import { QuantityStepperView } from "../quantity-stepper/index.js";
import { StockBadgeView } from "../stock-badge/index.js";
import template from "./template.html?raw";
import templateImage from "./image.html?raw";
import templatePlaceholder from "./placeholder.html?raw";
import templateOptions from "./options.html?raw";
import templateOption from "./option.html?raw";
import templateOptionsEditor from "./options-editor.html?raw";

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

// Prix d'une ligne disponible en promotion (PRO-c) : rouge des promotions.
const PROMO_PRICE_CLASSES = "text-accent";

// Ligne du panier, telle que la prépare le modèle de la page : les prix sont
// déjà mis en forme, le statut de stock déjà calculé. stockNote vaut le texte
// « Quantité ajustée… » ou null. originalTotal est le total avant remise du
// produit en promotion (PRO-c), ou null. options (OPT-a) vaut null si le produit n'en
// propose aucune. Le composant signale le changement de quantité, le retrait
// de la ligne et les actions sur les options par les fonctions de actions.
let CartLineView = {
  /**
   * @param {{variantId: number, productId: number, name: string, label: string,
   *   details: string, imageUrl: ?string, quantity: number, maxQuantity: number,
   *   total: string, originalTotal: ?string, stockStatus: "in"|"low"|"out", isSoldOut: boolean,
   *   stockNote: ?string, options: ?{isEditing: boolean,
   *     selected: Array<{label: string, price: string}>,
   *     actionLabel: ?string, quickAddId: ?number,
   *     editor: ?Parameters<typeof ProductOptionsView.dom>[0]}}} line
   *   options.actionLabel : texte du lien, ou null (article épuisé) ;
   *   options.quickAddId : option ajoutée directement par le lien, ou null
   *   (le lien ouvre alors la modification) ; options.editor : cases à cocher
   *   affichées pendant la modification.
   * @param {{onQuantity: (variantId: number, quantity: number) => void,
   *   onRemove: (variantId: number) => void,
   *   onEditOptions: (variantId: number) => void,
   *   onToggleOption: (variantId: number, optionId: number, isSelected: boolean) => void,
   *   onCloseOptions: (variantId: number) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (line, actions) {
    let tone = line.isSoldOut ? TONES.soldOut : TONES.available;
    if (!line.isSoldOut && line.originalTotal !== null) {
      tone = { ...tone, priceClasses: PROMO_PRICE_CLASSES };
    }
    let fragment = htmlToFragment(
      genericRenderer(template, {
        ...line,
        ...tone,
        stockNote: line.stockNote ?? "",
        originalTotal: line.originalTotal ?? "",
      })
    );

    if (line.originalTotal === null) {
      fragment.querySelector("[data-original-total]").remove();
    }

    fragment.querySelector('slot[name="visual"]').replaceWith(CartLineView.visual(line.imageUrl));
    fragment.querySelector('slot[name="stock"]').replaceWith(StockBadgeView.dom(line.stockStatus));

    let optionsSlot = fragment.querySelector('slot[name="options"]');
    if (line.options === null) {
      optionsSlot.remove();
    } else {
      optionsSlot.replaceWith(CartLineView.options(line.variantId, line.options, actions));
    }

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
   * Bloc des options d'une ligne (OPT-a) : la liste des options cochées avec
   * son lien, ou les cases à cocher pendant la modification.
   *
   * @param {number} variantId - Ligne concernée.
   * @param {NonNullable<Parameters<typeof CartLineView.dom>[0]["options"]>} options
   * @param {Parameters<typeof CartLineView.dom>[1]} actions
   * @returns {DocumentFragment}
   */
  options: function (variantId, options, actions) {
    if (options.isEditing) {
      let fragment = htmlToFragment(templateOptionsEditor);
      fragment.querySelector('slot[name="editor"]').replaceWith(
        ProductOptionsView.dom(options.editor, {
          onToggle: (optionId, isSelected) => actions.onToggleOption(variantId, optionId, isSelected),
        })
      );
      fragment.querySelector("[data-options-close]").addEventListener("click", () => actions.onCloseOptions(variantId));
      return fragment;
    }

    let fragment = htmlToFragment(genericRenderer(templateOptions, { actionLabel: options.actionLabel ?? "" }));
    fragment
      .querySelector('slot[name="selected"]')
      .replaceWith(...options.selected.map((option) => htmlToFragment(genericRenderer(templateOption, option))));

    // Un template n'a pas de condition : « Sans option » et le lien se règlent ici.
    if (options.selected.length > 0 || options.quickAddId !== null) {
      fragment.querySelector("[data-no-option]").remove();
    }

    let button = fragment.querySelector("[data-options-action]");
    if (options.actionLabel === null) {
      button.remove();
    } else if (options.quickAddId === null) {
      button.addEventListener("click", () => actions.onEditOptions(variantId));
    } else {
      button.addEventListener("click", () => actions.onToggleOption(variantId, options.quickAddId, true));
    }

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
