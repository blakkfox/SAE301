import { htmlToFragment } from "../../lib/utils.js";
import { CarteFilmView } from "../carte-film/index.js";
import template from "./template.html?raw";
import templateVide from "./vide.html?raw";

// Grille de cartes. Elle compose un autre composant, CarteFilmView : les
// cartes prennent la place du <slot name="cartes">.
let GrilleFilmsView = {
  dom: function (films) {
    if (films.length === 0) {
      return htmlToFragment(templateVide);
    }

    let fragment = htmlToFragment(template);
    let cartes = films.map((film) => CarteFilmView.dom(film));
    fragment.querySelector('slot[name="cartes"]').replaceWith(...cartes);
    return fragment;
  },
};

export { GrilleFilmsView };
