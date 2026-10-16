import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templatePage from "./page.html?raw";

// Navigation entre les pages du catalogue : ‹ 1 2 … ›.
// Un template par élément répété : chaque numéro a le sien (page.html).
let PaginationView = {
  /**
   * @param {{page: number, pagesTotal: number, pages: number[]}} data - Page
   *   courante, nombre de pages, et numéros à afficher (calculés par le modèle).
   * @param {{surPage: (page: number) => void}} actions
   * @returns {DocumentFragment} La pagination, ou un fragment vide s'il n'y a
   *   qu'une page.
   */
  dom: function (data, actions) {
    if (data.pagesTotal <= 1) {
      return htmlToFragment("");
    }

    let fragment = htmlToFragment(
      genericRenderer(template, { previous: data.page - 1, next: data.page + 1 })
    );

    let pages = data.pages.map((number) => {
      let pageFragment = htmlToFragment(genericRenderer(templatePage, { number }));
      if (number === data.page) {
        pageFragment.querySelector("button").setAttribute("aria-current", "page");
      }
      return pageFragment;
    });
    fragment.querySelector('slot[name="pages"]').replaceWith(...pages);

    // Un template n'a pas de condition : les bornes se règlent ici.
    let buttons = fragment.querySelectorAll("button[data-page]");
    buttons[0].disabled = data.page <= 1;
    buttons[buttons.length - 1].disabled = data.page >= data.pagesTotal;

    // Délégation : un seul écouteur sur le <nav> pour tous les boutons.
    fragment.querySelector("nav").addEventListener("click", (ev) => {
      let button = ev.target.closest("button[data-page]");
      if (button === null || button.disabled || button.hasAttribute("aria-current")) return;
      actions.surPage(Number(button.dataset.page));
    });

    return fragment;
  },
};

export { PaginationView };
