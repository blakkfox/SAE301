import { applyFieldErrors, genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { MessageView } from "../message/index.js";
import template from "./template.html?raw";

// Formulaire « Mot de passe » de l'espace personnel (US SUI-b, écran 14).
// Il transmet les trois saisies par actions.onChange sans les juger : c'est
// le serveur qui vérifie le mot de passe actuel et valide le nouveau. Les
// champs repartent toujours vides.
let PasswordChangeFormView = {
  /**
   * @param {{email: string, errors: Object<string, string>, notice: ?{type: string, texte: string},
   *   isSubmitting: boolean}} data
   *   email : adresse du compte, pour le gestionnaire de mots de passe ; notice : résultat de l'envoi.
   * @param {{onChange: (change: {currentPassword: string, password: string,
   *   passwordConfirm: string}) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(
      genericRenderer(template, {
        email: data.email,
        submitLabel: data.isSubmitting ? "Modification…" : "Changer le mot de passe",
      }),
    );
    let form = fragment.querySelector("form");

    applyFieldErrors(form, data.errors);
    fragment.querySelector("[data-form-notice]").replaceChildren(MessageView.dom(data.notice));
    form.setAttribute("aria-busy", String(data.isSubmitting));
    form.querySelector('[type="submit"]').disabled = data.isSubmitting;

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      actions.onChange({
        currentPassword: form.elements.currentPassword.value,
        password: form.elements.password.value,
        passwordConfirm: form.elements.passwordConfirm.value,
      });
    });

    return fragment;
  },
};

export { PasswordChangeFormView };
