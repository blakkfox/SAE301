import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { formaterDuree, formaterNote } from "../../lib/format.js";
import template from "./template.html?raw";
import templateLigne from "./ligne-genre.html?raw";

// Tableau de bord de la zone d'administration.
// Un template par élément répété : la ligne de genre a le sien, et chaque
// ligne prend place dans le <slot name="genres">.
let StatistiquesView = {
  /**
   * @param {{total: number, noteMoyenne: number, dureeMoyenne: number,
   *          parGenre: Array<{genre: string, nombre: number}>}} stats
   */
  dom: function (stats) {
    let fragment = htmlToFragment(
      genericRenderer(template, {
        total: stats.total,
        noteMoyenne: formaterNote(stats.noteMoyenne),
        dureeMoyenne: formaterDuree(stats.dureeMoyenne),
      })
    );

    let lignes = stats.parGenre.map((ligne) => htmlToFragment(genericRenderer(templateLigne, ligne)));
    fragment.querySelector('slot[name="genres"]').replaceWith(...lignes);

    return fragment;
  },
};

export { StatistiquesView };
