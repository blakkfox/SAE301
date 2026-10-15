import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Les classes sont écrites en entier, et non assemblées (« text-" + couleur ») :
// Tailwind ne génère que les classes qu'il trouve telles quelles dans le code.
const COULEURS = {
  erreur: "border-red-700 text-red-700 dark:border-red-400 dark:text-red-400",
  succes: "border-green-700 text-green-700 dark:border-green-400 dark:text-green-400",
};

// Message d'information ou d'erreur. data vaut { type: "erreur" | "succes",
// texte }, ou null pour n'afficher aucun message.
let MessageView = {
  html: function (data) {
    if (data === null) {
      return "";
    }
    return genericRenderer(template, { texte: data.texte, couleurs: COULEURS[data.type] });
  },

  dom: function (data) {
    return htmlToFragment(MessageView.html(data));
  },
};

export { MessageView };
