import { applyFieldErrors, genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { MessageView } from "../message/index.js";
import template from "./template.html?raw";
import templateOption from "./option.html?raw";

// Formulaire « Mes informations » de l'espace personnel (US SUI-b, écran 14).
// Il affiche les valeurs, les concessions, les erreurs et le message reçus,
// et transmet la saisie par actions.onSave : c'est le serveur qui valide.
let ProfileFormView = {
  /**
   * @param {{values: {firstName: string, lastName: string, email: string, phone: string,
   *   preferredDealershipId: ?number}, dealerships: Array<{id: number, name: string}>,
   *   errors: Object<string, string>, notice: ?{type: string, texte: string}, isSubmitting: boolean}} data
   * @param {{onSave: (profile: {firstName: string, lastName: string, email: string, phone: string,
   *   preferredDealershipId: ?number}) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(
      genericRenderer(template, {
        firstName: data.values.firstName,
        lastName: data.values.lastName,
        email: data.values.email,
        phone: data.values.phone,
        submitLabel: data.isSubmitting ? "Enregistrement…" : "Enregistrer",
      }),
    );
    let form = fragment.querySelector("form");
    let select = form.elements.preferredDealershipId;

    select.append(...data.dealerships.map((dealership) => htmlToFragment(genericRenderer(templateOption, dealership))));

    // Un template n'a pas de condition : la concession choisie et l'état se règlent ici.
    select.value = data.values.preferredDealershipId === null ? "" : String(data.values.preferredDealershipId);
    form.setAttribute("aria-busy", String(data.isSubmitting));
    form.querySelector('[type="submit"]').disabled = data.isSubmitting;
    applyFieldErrors(form, data.errors);
    fragment.querySelector("[data-form-notice]").replaceChildren(MessageView.dom(data.notice));

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      actions.onSave({
        firstName: form.elements.firstName.value,
        lastName: form.elements.lastName.value,
        email: form.elements.email.value,
        phone: form.elements.phone.value,
        preferredDealershipId: select.value === "" ? null : Number(select.value),
      });
    });

    return fragment;
  },
};

export { ProfileFormView };
