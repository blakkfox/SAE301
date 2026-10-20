import { applyFieldErrors, genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Formulaire « Mot de passe oublié » (US CMD-c) : adresse, nouveau mot de
// passe et confirmation. Il transmet les saisies et signale le retour à la
// connexion ; c'est le serveur qui valide.
let PasswordResetFormView = {
  /**
   * @param {{email: string, isSubmitting: boolean}} data
   * @returns {string} Le HTML du formulaire.
   */
  html: function (data) {
    return genericRenderer(template, {
      email: data.email,
      submitLabel: data.isSubmitting ? "Enregistrement…" : "Enregistrer le mot de passe",
    });
  },

  /**
   * @param {{email: string, errors: Object<string, string>, isSubmitting: boolean}} data
   *   Adresse à pré-remplir, erreurs par champ, envoi en cours.
   * @param {{onReset: (reset: {email: string, password: string, passwordConfirm: string}) => void,
   *          onCancel: () => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(PasswordResetFormView.html(data));
    let form = fragment.querySelector("form");

    applyFieldErrors(form, data.errors);
    form.setAttribute("aria-busy", String(data.isSubmitting));
    form.querySelector('[type="submit"]').disabled = data.isSubmitting;

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      actions.onReset({
        email: form.elements.email.value,
        password: form.elements.password.value,
        passwordConfirm: form.elements.passwordConfirm.value,
      });
    });

    form.querySelector('[data-action="cancel"]').addEventListener("click", () => actions.onCancel());

    return fragment;
  },
};

export { PasswordResetFormView };
