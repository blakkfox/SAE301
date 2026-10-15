import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Barre de réglages du catalogue : critère de tri et nombre de films par page.
// Le composant ne décide de rien : il affiche les valeurs reçues, et signale
// les changements par les fonctions reçues dans actions.
let BarreOutilsView = {
  html: function (data) {
    return genericRenderer(template, data);
  },

  /**
   * @param {{tri: string, parPage: number, total: number}} data
   * @param {{surTri: (tri: string) => void,
   *          surParPage: (parPage: number) => void}} actions
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(BarreOutilsView.html(data));
    let tri = fragment.querySelector('select[name="tri"]');
    let parPage = fragment.querySelector('select[name="parPage"]');

    // Un template n'a pas de condition : l'option choisie se règle ici.
    tri.value = data.tri;
    parPage.value = String(data.parPage);

    tri.addEventListener("change", () => actions.surTri(tri.value));
    parPage.addEventListener("change", () => actions.surParPage(Number(parPage.value)));

    return fragment;
  },
};

export { BarreOutilsView };
