import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Menu « Mon compte » de l'espace client (SUI-c, SUI-b) : « Mes informations »,
// « Mes commandes », « Déconnexion ». Il reçoit l'entrée de la page affichée
// et l'état de la déconnexion, et signale le clic par actions.onLogout.
let AccountMenuView = {
  /**
   * @param {{current: "informations"|"orders", logoutLabel: string, isLoggingOut: boolean}} data
   * @param {{onLogout: () => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(genericRenderer(template, { logoutLabel: data.logoutLabel }));

    // Posé ici et non par le routeur : le menu est reconstruit pendant la
    // déconnexion, après le passage du routeur.
    fragment.querySelector(`[data-entry="${data.current}"]`).setAttribute("aria-current", "page");

    let logout = fragment.querySelector('[data-action="logout"]');
    logout.disabled = data.isLoggingOut;
    logout.addEventListener("click", () => actions.onLogout());

    return fragment;
  },
};

export { AccountMenuView };
