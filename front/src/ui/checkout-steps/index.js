import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateStep from "./step.html?raw";
import templateSeparator from "./separator.html?raw";

// Classes de chaque état, écrites en entier : Tailwind ne génère que les
// classes qu'il trouve telles quelles dans le code. Toutes les pastilles ont
// une bordure (transparente sauf « à venir ») : leur taille ne varie pas.
const STATES = {
  done: {
    containerClasses: "border-transparent bg-page text-ink",
    markerClasses: "bg-success text-ink-inverse",
    status: " (terminée)",
  },
  current: {
    containerClasses: "border-action bg-action text-on-action",
    markerClasses: "bg-page text-accent",
    status: " (étape en cours)",
  },
  todo: {
    containerClasses: "border-line text-ink",
    markerClasses: "bg-section text-ink-muted",
    status: " (à venir)",
  },
};

// Fil des étapes de la commande. Le composant reçoit les étapes déjà
// préparées par la page ; il n'a aucune action à signaler.
let CheckoutStepsView = {
  /**
   * @param {Array<{number: number, label: string, state: "done"|"current"|"todo"}>} steps
   * @returns {DocumentFragment}
   */
  dom: function (steps) {
    let fragment = htmlToFragment(template);
    let items = steps.flatMap((step, index) =>
      index === 0 ? [CheckoutStepsView.step(step)] : [htmlToFragment(templateSeparator), CheckoutStepsView.step(step)]
    );
    fragment.querySelector('slot[name="steps"]').replaceWith(...items);
    return fragment;
  },

  /**
   * @param {{number: number, label: string, state: "done"|"current"|"todo"}} step
   * @returns {DocumentFragment} Une pastille ; l'étape en cours porte aria-current.
   */
  step: function (step) {
    let fragment = htmlToFragment(
      genericRenderer(templateStep, {
        ...STATES[step.state],
        label: step.label,
        marker: step.state === "done" ? "✓" : step.number,
      })
    );

    if (step.state === "current") {
      fragment.firstElementChild.setAttribute("aria-current", "step");
    }
    return fragment;
  },
};

export { CheckoutStepsView };
