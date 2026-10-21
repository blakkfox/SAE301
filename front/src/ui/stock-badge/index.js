import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Modifier CSS de chaque statut, écrit en entier (voir global.css).
const MODIFIERS = {
  in: "",
  low: "stock-badge--low",
  out: "stock-badge--out",
};

// Libellés de la maquette.
const LABELS = {
  in: "En stock",
  low: "Bientôt épuisé",
  out: "Épuisé",
};

// Pastille « En stock », « Bientôt épuisé » ou « Épuisé ». Le composant reçoit
// le statut déjà calculé (getStockStatus dans lib/stock.js).
let StockBadgeView = {
  /**
   * @param {"in"|"low"|"out"} status
   * @returns {string} Le HTML de la pastille.
   */
  html: function (status) {
    return genericRenderer(template, { modifier: MODIFIERS[status], label: LABELS[status] });
  },

  /**
   * @param {"in"|"low"|"out"} status
   * @returns {DocumentFragment}
   */
  dom: function (status) {
    return htmlToFragment(StockBadgeView.html(status));
  },
};

export { StockBadgeView };
