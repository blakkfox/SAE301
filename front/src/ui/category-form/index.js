import { applyFieldErrors, genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateOption from "./option.html?raw";

// Formulaire d'une catégorie au back-office (US GOF-c). Comme les autres
// formulaires, il ne garde rien et ne décide de rien : il affiche les valeurs
// et les erreurs reçues, et transmet la saisie par actions.
let CategoryFormView = {
  /**
   * @param {{title: string, values: {name: string, description: string, isVisible: boolean, parentId: ?number},
   *   parentOptions: Array<{id: number, name: string}>, isParentLocked: boolean, parentHint: string,
   *   errors: Object<string, string>, isSubmitting: boolean}} data
   * @param {{onSubmit: (values: Object) => void, onChange: (values: Object) => void, onCancel: () => void}} actions
   *   onChange signale chaque saisie, pour qu'elle survive à une reconstruction de la page.
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(
      genericRenderer(template, {
        title: data.title,
        name: data.values.name,
        description: data.values.description,
        parentHint: data.parentHint,
        submitLabel: data.isSubmitting ? "Enregistrement…" : "Enregistrer",
      }),
    );
    let form = fragment.querySelector("form");

    let options = data.parentOptions.map((option) => htmlToFragment(genericRenderer(templateOption, option)));
    form.querySelector('slot[name="parents"]').replaceWith(...options);

    // Un template n'a pas de condition : valeurs et états se règlent ici.
    form.elements.parentId.value = data.values.parentId === null ? "" : String(data.values.parentId);
    form.elements.parentId.disabled = data.isParentLocked;
    form.querySelector("[data-parent-hint]").hidden = data.parentHint === "";
    form.elements.isVisible.checked = data.values.isVisible;
    form.setAttribute("aria-busy", String(data.isSubmitting));
    form.querySelector('[type="submit"]').disabled = data.isSubmitting;
    applyFieldErrors(form, data.errors);

    let readValues = () => ({
      name: form.elements.name.value,
      description: form.elements.description.value,
      isVisible: form.elements.isVisible.checked,
      parentId: form.elements.parentId.value === "" ? null : Number(form.elements.parentId.value),
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

export { CategoryFormView };
