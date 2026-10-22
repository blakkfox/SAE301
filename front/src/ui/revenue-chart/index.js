import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateBar from "./bar.html?raw";

// Classes de la barre, écrites en entier (voir .chart-bar dans global.css).
const BAR_CLASSES = {
  default: "",
  today: "chart-bar--today",
};

// Graphique des revenus par jour (US PIL-a). Il reçoit les barres déjà
// préparées : { day: « Mer », amount: « 212 € » ou « fermé », size: hauteur
// en % (0 à 100), isToday, description: phrase complète pour les lecteurs
// d'écran }. Il ne calcule rien.
let RevenueChartView = {
  /**
   * @param {Array<{day: string, amount: string, size: number, isToday: boolean, description: string}>} bars
   * @returns {DocumentFragment}
   */
  dom: function (bars) {
    let fragment = htmlToFragment(template);

    let items = bars.map((bar) =>
      htmlToFragment(
        genericRenderer(templateBar, {
          day: bar.day,
          amount: bar.amount,
          size: bar.size,
          barClass: BAR_CLASSES[bar.isToday ? "today" : "default"],
          description: bar.description,
        }),
      ),
    );
    fragment.querySelector('slot[name="bars"]').replaceWith(...items);

    return fragment;
  },
};

export { RevenueChartView };
