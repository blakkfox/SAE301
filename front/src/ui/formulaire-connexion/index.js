import { applyFieldErrors, genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Formulaire de connexion (US CMD-c, écran 5). Il ne conserve rien et ne
// décide de rien : il transmet les identifiants saisis, et c'est le serveur
// qui accepte ou refuse. Les erreurs reçues s'affichent sous leur champ.
let FormulaireConnexionView = {
  /**
   * @param {{email: string, isSubmitting: boolean}} data
   * @returns {string} Le HTML du formulaire.
   */
  html: function (data) {
    return genericRenderer(template, {
      email: data.email,
      submitLabel: data.isSubmitting ? "Connexion…" : "Se connecter",
    });
  },

  /**
   * @param {{email: string, errors: Object<string, string>, isSubmitting: boolean}} data
   *   Adresse à pré-remplir, erreurs par champ, envoi en cours.
   * @param {{surConnexion: (email: string, password: string) => void,
   *          onForgotPassword: (email: string) => void}} actions
   *   onForgotPassword reçoit l'adresse déjà saisie, pour la reprendre.
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(FormulaireConnexionView.html(data));
    let formulaire = fragment.querySelector("form");

    applyFieldErrors(formulaire, data.errors);
    formulaire.setAttribute("aria-busy", String(data.isSubmitting));
    formulaire.querySelector('[type="submit"]').disabled = data.isSubmitting;

    formulaire.addEventListener("submit", (ev) => {
      // Sans cela, le navigateur enverrait le formulaire de manière classique,
      // en rechargeant la page.
      ev.preventDefault();
      actions.surConnexion(formulaire.elements.email.value, formulaire.elements.password.value);
    });

    fragment
      .querySelector('[data-action="forgot-password"]')
      .addEventListener("click", () => actions.onForgotPassword(formulaire.elements.email.value));

    return fragment;
  },
};

export { FormulaireConnexionView };
