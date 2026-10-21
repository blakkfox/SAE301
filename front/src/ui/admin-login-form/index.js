import { applyFieldErrors, genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Formulaire de connexion du back-office (US GOF-b). Comme celui des clients,
// il ne garde rien et ne décide de rien : il transmet les identifiants, et
// affiche sous leur champ les erreurs reçues.
let AdminLoginFormView = {
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
   *   Identifiant à pré-remplir, erreurs par champ, envoi en cours.
   * @param {{onLogin: (email: string, password: string) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(AdminLoginFormView.html(data));
    let form = fragment.querySelector("form");

    applyFieldErrors(form, data.errors);
    form.setAttribute("aria-busy", String(data.isSubmitting));
    form.querySelector('[type="submit"]').disabled = data.isSubmitting;

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      actions.onLogin(form.elements.email.value, form.elements.password.value);
    });

    return fragment;
  },
};

export { AdminLoginFormView };
