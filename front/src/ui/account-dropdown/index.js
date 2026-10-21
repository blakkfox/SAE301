import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateGuest from "./guest.html?raw";

// Compte de l'en-tête (US SUI-b) : « Mon compte » hors connexion, sinon le
// prénom, qui ouvre un menu « Mes informations », « Mes commandes »,
// « Déconnexion ». Il reçoit l'état ouvert / fermé et celui de la
// déconnexion, et signale les clics par actions.onToggle et actions.onLogout.
let AccountDropdownView = {
  /**
   * @param {{firstName: ?string, isOpen: boolean, logoutLabel: string, isLoggingOut: boolean}} data
   *   firstName : prénom du compte connecté, ou null si personne n'est connecté.
   * @param {{onToggle: () => void, onLogout: () => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    if (data.firstName === null) {
      return htmlToFragment(templateGuest);
    }

    let fragment = htmlToFragment(
      genericRenderer(template, { firstName: data.firstName, logoutLabel: data.logoutLabel }),
    );
    let toggle = fragment.querySelector('[data-action="toggle"]');
    let logout = fragment.querySelector('[data-action="logout"]');

    // Un template n'a pas de condition : l'état ouvert se règle ici.
    toggle.setAttribute("aria-expanded", String(data.isOpen));
    fragment.querySelector("#account-dropdown").hidden = !data.isOpen;
    logout.disabled = data.isLoggingOut;

    toggle.addEventListener("click", () => actions.onToggle());
    logout.addEventListener("click", () => actions.onLogout());

    return fragment;
  },
};

export { AccountDropdownView };
