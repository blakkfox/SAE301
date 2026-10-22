import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { SizeGuideView } from "../size-guide/index.js";
import template from "./template.html?raw";
import templateOption from "./option.html?raw";

// Classes d'une option selon son stock (STK-b), écrites en entier : Tailwind
// ne génère que les classes qu'il trouve telles quelles dans le code.
const STATE_CLASSES = {
  available: "border-line bg-page text-ink",
  soldOut: "border-transparent bg-section text-ink-disabled line-through",
};

// Texte masqué lu après le libellé, selon le stock de la variante.
const STOCK_TEXTS = {
  in: "",
  low: " (bientôt épuisé)",
  out: " (épuisé)",
};

// Choix de la variante d'un produit (OPT-b). Le composant reçoit les
// variantes et les textes déjà préparés (légende, stock restant, variantes
// épuisées) et signale le choix par actions.onSelect.
let VariantPickerView = {
  /**
   * @param {{legend: string, stockNote: ?string, soldOutNote: ?string, hasSizeGuide: boolean,
   *   options: Array<{id: number, label: string, isSelected: boolean,
   *     stockStatus: "in"|"low"|"out"}>}} data
   * @param {{onSelect: (variantId: number) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(
      genericRenderer(template, {
        legend: data.legend,
        stockNote: data.stockNote ?? "",
        soldOutNote: data.soldOutNote ?? "",
      })
    );

    let options = data.options.map((option) => {
      let item = htmlToFragment(
        genericRenderer(templateOption, {
          id: option.id,
          label: option.label,
          stateClasses: option.stockStatus === "out" ? STATE_CLASSES.soldOut : STATE_CLASSES.available,
          stockText: STOCK_TEXTS[option.stockStatus],
        })
      );
      // Un template n'a pas de condition : sélection et point orange se règlent ici.
      item.querySelector("input").checked = option.isSelected;
      if (option.stockStatus !== "low") {
        item.querySelector("[data-low-stock-dot]").remove();
      }
      return item;
    });
    fragment.querySelector('slot[name="options"]').replaceWith(...options);

    if (data.stockNote === null) {
      fragment.querySelector("[data-variant-stock]").remove();
    }
    if (data.soldOutNote === null) {
      fragment.querySelector("[data-variant-sold-out]").remove();
    }

    let guideSlot = fragment.querySelector('slot[name="size-guide"]');
    if (data.hasSizeGuide) {
      guideSlot.replaceWith(SizeGuideView.dom());
    } else {
      guideSlot.remove();
    }

    let info = fragment.querySelector("[data-variant-info]");
    if (info.children.length === 0) {
      info.remove();
    }

    // Délégation : un seul écouteur pour tous les boutons radio.
    fragment.querySelector("fieldset").addEventListener("change", (ev) => {
      actions.onSelect(Number(ev.target.value));
    });

    return fragment;
  },
};

export { VariantPickerView };
