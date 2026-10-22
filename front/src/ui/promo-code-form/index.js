import { applyFieldErrors, genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Formulaire d'un code promo au back-office (US PRO-b). Comme les autres
// formulaires, il ne garde rien et ne décide de rien : il affiche les valeurs
// et les erreurs reçues, et transmet la saisie, telle quelle, par actions.
let PromoCodeFormView = {
  /**
   * @param {{title: string, submitLabel: string, maxUsesHint: string, isEditing: boolean,
   *   values: {code: string, discountRate: string, minAmount: string, startsOn: string, endsOn: string,
   *     maxUses: string},
   *   errors: Object<string, string>, isSubmitting: boolean}} data
   *   isEditing : « Annuler » n'est proposé qu'en modification.
   * @param {{onSubmit: (values: Object) => void, onChange: (values: Object) => void, onCancel: () => void}} actions
   *   onChange signale chaque saisie, pour qu'elle survive à une reconstruction de la page.
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(
      genericRenderer(template, {
        title: data.title,
        submitLabel: data.submitLabel,
        maxUsesHint: data.maxUsesHint,
        ...data.values,
      }),
    );
    let form = fragment.querySelector("form");

    // Un template n'a pas de condition : les états se règlent ici.
    form.setAttribute("aria-busy", String(data.isSubmitting));
    form.querySelector('[type="submit"]').disabled = data.isSubmitting;
    form.querySelector('[data-action="cancel"]').hidden = !data.isEditing;
    applyFieldErrors(form, data.errors);

    let readValues = () => ({
      code: form.elements.code.value,
      discountRate: form.elements.discountRate.value,
      minAmount: form.elements.minAmount.value,
      startsOn: form.elements.startsOn.value,
      endsOn: form.elements.endsOn.value,
      maxUses: form.elements.maxUses.value,
    });

    form.addEventListener("input", () => actions.onChange(readValues()));
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      actions.onSubmit(readValues());
    });
    form.querySelector('[data-action="cancel"]').addEventListener("click", () => actions.onCancel());

    return fragment;
  },
};

export { PromoCodeFormView };
