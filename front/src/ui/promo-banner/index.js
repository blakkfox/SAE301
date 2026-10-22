import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Bandeau de la promotion automatique (PRO-c). Il reçoit la phrase déjà
// rédigée et l'adresse de la fiche du produit : { text, url }.
let PromoBannerView = {
  /**
   * @param {{text: string, url: string}} promotion
   * @returns {string} Le HTML du bandeau.
   */
  html: function (promotion) {
    return genericRenderer(template, promotion);
  },

  /**
   * @param {{text: string, url: string}} promotion
   * @returns {DocumentFragment}
   */
  dom: function (promotion) {
    return htmlToFragment(PromoBannerView.html(promotion));
  },
};

export { PromoBannerView };
