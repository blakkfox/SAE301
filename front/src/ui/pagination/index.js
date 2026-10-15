import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Navigation entre les pages du catalogue.
let PaginationView = {
  html: function (data) {
    return genericRenderer(template, data);
  },

  /**
   * @param {{page: number, pagesTotal: number}} data
   * @param {{surPage: (page: number) => void}} actions
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(PaginationView.html(data));
    let precedente = fragment.querySelector('[data-action="precedente"]');
    let suivante = fragment.querySelector('[data-action="suivante"]');

    precedente.disabled = data.page <= 1;
    suivante.disabled = data.page >= data.pagesTotal;

    precedente.addEventListener("click", () => actions.surPage(data.page - 1));
    suivante.addEventListener("click", () => actions.surPage(data.page + 1));

    return fragment;
  },
};

export { PaginationView };
