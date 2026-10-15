import { htmlToFragment } from "../../lib/utils.js";
import { basculerTheme } from "../../lib/theme.js";
import template from "./template.html?raw";

// HeaderView est un composant sans données : il n'a que son template, et le
// bouton de thème, dont il gère lui-même le clic.
let HeaderView = {
  html: function () {
    return template;
  },

  dom: function () {
    let fragment = htmlToFragment(template);
    fragment.querySelector('[data-action="theme"]').addEventListener("click", basculerTheme);
    return fragment;
  },
};

export { HeaderView };
