import { htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Pied de page noir de la charte. Composant statique, sans données.
let FooterView = {
  /**
   * @returns {string} Le HTML du pied de page.
   */
  html: function () {
    return template;
  },

  /**
   * @returns {DocumentFragment} Le pied de page, prêt à être inséré.
   */
  dom: function () {
    return htmlToFragment(template);
  },
};

export { FooterView };
