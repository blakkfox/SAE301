import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Fond du bloc : vert pâle de la maquette quand un code est appliqué.
const STATES = {
  default: "bg-section",
  applied: "bg-success-soft",
};

// Couleur du message. Comme pour MessageView, le vert Statut/Succès n'est pas
// assez contrasté pour un texte de 15 px : le succès reste en gris anthracite.
const MESSAGES = {
  success: "text-ink",
  error: "text-accent",
  info: "text-ink-muted",
};

// Champ « Code promo » avec son bouton « Appliquer » (US PRO-a). Le composant
// ne vérifie rien : il signale le code saisi par actions.onApply, ou son
// retrait par actions.onRemove ; c'est la page qui l'interroge auprès de l'API.
let PromoCodeFieldView = {
  /**
   * @param {{value: string, isApplied: boolean, isPending: boolean,
   *   message: ?{type: "success"|"error"|"info", text: string}}} data -
   *   value : texte du champ ; isPending : vérification en cours.
   * @param {{onApply: (code: string) => void, onRemove: () => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(
      genericRenderer(template, {
        value: data.value,
        applyLabel: data.isPending ? "Vérification…" : "Appliquer",
        stateClasses: STATES[data.isApplied ? "applied" : "default"],
        message: data.message === null ? "" : data.message.text,
        messageClasses: data.message === null ? "" : MESSAGES[data.message.type],
      })
    );

    // Le bouton reste actif pendant la vérification : désactivé, il perdrait
    // le focus quand la page reconstruit le bloc. La page ignore un second envoi.
    let form = fragment.firstElementChild;
    form.setAttribute("aria-busy", String(data.isPending));
    form.querySelector("input").setAttribute("aria-invalid", String(data.message?.type === "error"));

    if (!data.isApplied) {
      form.querySelector("[data-promo-remove]").remove();
    }

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      actions.onApply(ev.currentTarget.elements.promoCode.value);
    });
    form.addEventListener("click", (ev) => {
      if (ev.target.closest("[data-promo-remove]") !== null) {
        actions.onRemove();
      }
    });

    return fragment;
  },
};

export { PromoCodeFieldView };
