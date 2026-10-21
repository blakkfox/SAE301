import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Couleur de la valeur, écrite en entier (voir global.css) : « alert » met
// en rouge Honda une valeur qui demande une action (produits épuisés).
const TONES = {
  default: "text-ink",
  alert: "text-accent",
};

// Carte indicateur (US GOF-b) : { label, value, caption, tone }, valeurs déjà
// mises en forme. À placer dans une liste de définitions (<dl>).
let StatCardView = {
  /**
   * @param {{label: string, value: string, caption: string, tone: "default"|"alert"}} data
   * @returns {string} Le HTML de la carte.
   */
  html: function (data) {
    return genericRenderer(template, { ...data, tone: TONES[data.tone] });
  },

  /**
   * @param {{label: string, value: string, caption: string, tone: "default"|"alert"}} data
   * @returns {DocumentFragment}
   */
  dom: function (data) {
    return htmlToFragment(StatCardView.html(data));
  },
};

export { StatCardView };
