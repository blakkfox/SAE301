/**
 * Échappe les caractères qui ont un sens en HTML.
 *
 * Sans cela, une donnée contenant « <img src=x onerror=…> » deviendrait une
 * vraie balise une fois insérée dans la page, et son script s'exécuterait.
 */
function escapeHtml(valeur) {
  return String(valeur)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Remplace les placeholders {{key}} d'un template par les valeurs de data.
 *
 * Les valeurs sont échappées : un placeholder ne produit jamais que du texte.
 * Pour insérer un autre composant, on passe par un <slot> (voir htmlToFragment).
 *
 * @param {string} template - Le template HTML contenant des placeholders {{key}}.
 * @param {Object} data - Les valeurs, indexées par le nom du placeholder.
 * @returns {string} - Le HTML obtenu.
 */
let genericRenderer = function (template, data) {
  let html = template;
  for (let key in data) {
    // Une fonction, et non une chaîne, comme valeur de remplacement : dans une
    // chaîne, replaceAll interpréterait les séquences spéciales comme « $& ».
    html = html.replaceAll(`{{${key}}}`, () => escapeHtml(data[key]));
  }
  return html;
};

/**
 * Convertit une chaîne HTML en DocumentFragment.
 *
 * Le fragment peut être manipulé (querySelector, replaceWith, addEventListener)
 * avant d'être inséré dans la page.
 *
 * @param {string} htmlString - Le HTML à convertir.
 * @returns {DocumentFragment}
 */
function htmlToFragment(htmlString) {
  const template = document.createElement("template");
  template.innerHTML = htmlString.trim(); // trim supprime les espaces inutiles
  return template.content;
}

export { genericRenderer, htmlToFragment };
