import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";

// Les classes sont écrites en entier, et non assemblées (« text-" + couleur ») :
// Tailwind ne génère que les classes qu'il trouve telles quelles dans le code.
const COULEURS = {
  erreur: "border-action bg-page text-accent",
  // Le vert Statut/Succès n'est pas assez contrasté pour du texte : il ne sert
  // qu'à la bordure, le texte reste en gris anthracite.
  succes: "border-success bg-success-soft text-ink",
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
