import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateGroups from "./groups.html?raw";
import templateGroup from "./group.html?raw";
import templateChildren from "./children.html?raw";
import templateItem from "./item.html?raw";
import templateStatus from "./status.html?raw";

// Menu déroulant des catégories de l'en-tête. Le composant ne décide de rien :
// il reçoit les catégories déjà préparées, ou le texte d'état à afficher
// pendant le chargement ou en cas d'erreur. Son ouverture est gérée par le
// layout (attribut hidden).
let CategoryMenuView = {
  /**
   * @param {{text: ?string, groups: Array<{name: string, url: string, count: number,
   *   countLabel: string, children: Array<{name: string, url: string}>}>}} menu
   *   text vaut null quand les catégories sont prêtes.
   * @returns {DocumentFragment} Le panneau du menu, fermé.
   */
  dom: function (menu) {
    let fragment = htmlToFragment(template);
    let slot = fragment.querySelector('slot[name="content"]');

    if (menu.text !== null) {
      slot.replaceWith(htmlToFragment(genericRenderer(templateStatus, { text: menu.text })));
      return fragment;
    }

    let groups = htmlToFragment(templateGroups);
    groups.querySelector('slot[name="groups"]').replaceWith(...menu.groups.map(CategoryMenuView.group));
    slot.replaceWith(groups);
    return fragment;
  },

  /**
   * @param {{name: string, url: string, count: number, countLabel: string,
   *   children: Array<{name: string, url: string}>}} group
   * @returns {DocumentFragment} Une catégorie et ses sous-catégories.
   */
  group: function (group) {
    let fragment = htmlToFragment(genericRenderer(templateGroup, group));
    let slot = fragment.querySelector('slot[name="children"]');

    if (group.children.length === 0) {
      slot.remove();
      return fragment;
    }

    let children = htmlToFragment(templateChildren);
    let items = group.children.map((child) => htmlToFragment(genericRenderer(templateItem, child)));
    children.querySelector('slot[name="items"]').replaceWith(...items);
    slot.replaceWith(children);
    return fragment;
  },
};

export { CategoryMenuView };
