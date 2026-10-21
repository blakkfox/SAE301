import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Modifier CSS de chaque statut (colonne customer_order.status), écrit en entier.
const MODIFIERS = {
  en_cours: "",
  disponible: "status-badge--success",
  retiree: "status-badge--neutral",
  annulee: "status-badge--error",
};

// Libellés de la maquette.
const LABELS = {
  en_cours: "En cours",
  disponible: "Disponible",
  retiree: "Retirée",
  annulee: "Annulée",
};

// Pastille « En cours », « Disponible », « Retirée » ou « Annulée ». Le
// composant reçoit le statut tel que l'API le renvoie.
let OrderStatusBadgeView = {
  /**
   * @param {"en_cours"|"disponible"|"retiree"|"annulee"} status
   * @returns {string} Le HTML de la pastille.
   */
  html: function (status) {
    return genericRenderer(template, { modifier: MODIFIERS[status], label: LABELS[status] });
  },

  /**
   * @param {"en_cours"|"disponible"|"retiree"|"annulee"} status
   * @returns {DocumentFragment}
   */
  dom: function (status) {
    return htmlToFragment(OrderStatusBadgeView.html(status));
  },
};

export { OrderStatusBadgeView };
