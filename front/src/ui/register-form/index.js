import { applyFieldErrors, genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Formulaire de création de compte (US CMD-c, écran 5). Comme le formulaire
// de connexion, il transmet les saisies sans les juger : c'est le serveur qui
// valide, et ses erreurs s'affichent sous leur champ. Les saisies reçues sont
// remises dans les champs, sauf les mots de passe, qui ne sont jamais
// réécrits dans la page.
let RegisterFormView = {
  /**
   * @param {{values: {firstName: string, lastName: string, email: string, phone: string},
   *   isSubmitting: boolean}} data
   * @returns {string} Le HTML du formulaire.
   */
  html: function (data) {
    return genericRenderer(template, {
      ...data.values,
      submitLabel: data.isSubmitting ? "Création du compte…" : "Créer mon compte",
    });
  },

  /**
   * @param {{values: {firstName: string, lastName: string, email: string, phone: string},
   *   errors: Object<string, string>, isSubmitting: boolean}} data
   *   Saisies à remettre, erreurs par champ, envoi en cours.
   * @param {{onRegister: (account: {firstName: string, lastName: string, email: string,
   *   phone: string, password: string, passwordConfirm: string}) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(RegisterFormView.html(data));
    let form = fragment.querySelector("form");

    applyFieldErrors(form, data.errors);
    form.setAttribute("aria-busy", String(data.isSubmitting));
    form.querySelector('[type="submit"]').disabled = data.isSubmitting;

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      actions.onRegister({
        firstName: form.elements.firstName.value,
        lastName: form.elements.lastName.value,
        email: form.elements.email.value,
        phone: form.elements.phone.value,
        password: form.elements.password.value,
        passwordConfirm: form.elements.passwordConfirm.value,
      });
    });

    return fragment;
  },
};

export { RegisterFormView };
