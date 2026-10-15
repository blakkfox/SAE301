import { htmlToFragment } from "../../lib/utils.js";
import { HeaderView } from "../../ui/header/index.js";
import template from "./template.html?raw";

/**
 * Layout principal : l'en-tête, puis la page affichée.
 *
 * Le slot nommé « header » est remplacé ici. Le slot sans nom est laissé au
 * routeur, qui y place la page.
 *
 * @returns {DocumentFragment}
 */
export function RootLayout() {
  let layout = htmlToFragment(template);
  layout.querySelector('slot[name="header"]').replaceWith(HeaderView.dom());
  return layout;
}
