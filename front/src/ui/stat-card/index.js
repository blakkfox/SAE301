import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Couleur de la valeur, écrite en entier (voir global.css) : « alert » met
// en rouge Honda une valeur qui demande une action (produits épuisés).
const TONES = {
  default: "text-ink",
  alert: "text-accent",
};

// Flèche devant la précision (US PIL-a) : hausse ou baisse par rapport à la
// période précédente. Le vert Statut/Succès ne colore que la flèche, assez
// contrastée pour un symbole mais pas pour du texte (voir MessageView).
const TRENDS = {
  none: { symbol: "", classes: "hidden" },
  up: { symbol: "▲", classes: "text-success" },
  down: { symbol: "▼", classes: "text-accent" },
};

// Carte indicateur (US GOF-b, PIL-a) : { label, value, caption, tone, trend },
// valeurs déjà mises en forme ; trend est facultatif. À placer dans une liste
// de définitions (<dl>).
let StatCardView = {
  /**
   * @param {{label: string, value: string, caption: string, tone: "default"|"alert",
   *   trend?: "none"|"up"|"down"}} data
   * @returns {string} Le HTML de la carte.
   */
  html: function (data) {
    let trend = TRENDS[data.trend ?? "none"];

    return genericRenderer(template, {
      label: data.label,
      value: data.value,
      caption: data.caption,
      tone: TONES[data.tone],
      trendSymbol: trend.symbol,
      trendClass: trend.classes,
    });
  },

  /**
   * @param {{label: string, value: string, caption: string, tone: "default"|"alert",
   *   trend?: "none"|"up"|"down"}} data
   * @returns {DocumentFragment}
   */
  dom: function (data) {
    return htmlToFragment(StatCardView.html(data));
  },
};

export { StatCardView };
