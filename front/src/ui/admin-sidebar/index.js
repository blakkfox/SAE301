import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Menu latéral de l'administration (US GOF-b). Il reçoit seulement l'état de
// la déconnexion, et signale le clic sur « Déconnexion » par actions.onLogout.
let AdminSidebarView = {
  /**
   * @param {{isLoggingOut: boolean}} data
   * @returns {string} Le HTML du menu.
   */
  html: function (data) {
    return genericRenderer(template, { logoutLabel: data.isLoggingOut ? "Déconnexion…" : "Déconnexion" });
  },

  /**
   * @param {{isLoggingOut: boolean}} data - Une déconnexion est en cours.
   * @param {{onLogout: () => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(AdminSidebarView.html(data));
    let button = fragment.querySelector('[data-action="logout"]');

    button.disabled = data.isLoggingOut;
    button.addEventListener("click", () => actions.onLogout());

    return fragment;
  },
};

export { AdminSidebarView };
