import { applyFieldErrors, genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Formulaire « Mot de passe oublié » (US CMD-c) : adresse, téléphone du
// compte (vérification), nouveau mot de passe et confirmation. Il transmet les saisies et signale le retour à la
// connexion ; c'est le serveur qui valide.
let PasswordResetFormView = {
  /**
   * @param {{email: string, phone: string, isSubmitting: boolean}} data
   * @returns {string} Le HTML du formulaire.
   */
  html: function (data) {
    return genericRenderer(template, {
      email: data.email,
      phone: data.phone,
      submitLabel: data.isSubmitting ? "Enregistrement…" : "Enregistrer le mot de passe",
    });
  },

  /**
   * @param {{email: string, phone: string, errors: Object<string, string>, isSubmitting: boolean}} data
   *   Adresse et téléphone à pré-remplir, erreurs par champ, envoi en cours.
   * @param {{onReset: (reset: {email: string, phone: string, password: string, passwordConfirm: string}) => void,
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
        phone: form.elements.phone.value,
        password: form.elements.password.value,
        passwordConfirm: form.elements.passwordConfirm.value,
      });
    });

    form.querySelector('[data-action="cancel"]').addEventListener("click", () => actions.onCancel());

    return fragment;
  },
};

export { PasswordResetFormView };
