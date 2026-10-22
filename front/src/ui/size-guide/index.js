import { htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Lien « Guide des tailles » et sa fenêtre (OPT-b). Le tableau est fixe : le
// composant ne reçoit aucune donnée. Ouvrir ou fermer la fenêtre ne change
// pas l'état de la page : il le gère seul, sans action à signaler.
let SizeGuideView = {
  /**
   * @returns {DocumentFragment} Le bouton, suivi de sa fenêtre fermée.
   */
  dom: function () {
    let fragment = htmlToFragment(template);
    let dialog = fragment.querySelector("dialog");

    fragment.querySelector("[data-size-guide-open]").addEventListener("click", () => {
      dialog.showModal();
    });

    // Délégation : un seul écouteur pour la croix et le bouton « Fermer ».
    dialog.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-size-guide-close]") !== null) {
        dialog.close();
      }
    });

    return fragment;
  },
};

export { SizeGuideView };
