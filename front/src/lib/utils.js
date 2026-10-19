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

/**
 * Remplace un élément affiché par un fragment reconstruit, sans perdre le
 * focus du clavier.
 *
 * Les éléments focalisables du bloc portent un attribut data-focus-key unique
 * dans ce bloc (« plus », « variant-12 »…). Si le focus était sur l'un d'eux,
 * il est rendu à son équivalent dans le nouveau bloc. Sans cela, reconstruire
 * un bloc après un clic renverrait le focus au début de la page.
 *
 * @param {Element} element - Élément actuellement affiché.
 * @param {DocumentFragment} fragment - Remplaçant ; son premier élément
 *   devient le nouvel élément affiché.
 * @returns {Element} Le nouvel élément affiché.
 */
function replaceKeepingFocus(element, fragment) {
  let focused = document.activeElement?.closest("[data-focus-key]");
  let key = focused !== null && focused !== undefined && element.contains(focused) ? focused.dataset.focusKey : null;

  let newElement = fragment.firstElementChild;
  element.replaceWith(fragment);

  if (key !== null) {
    let target = newElement.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    // Un bouton devenu désactivé (quantité maximale atteinte…) ne peut pas
    // recevoir le focus : on le donne alors au bloc lui-même.
    if (target !== null && !target.disabled) {
      target.focus();
    } else {
      newElement.focus();
    }
  }

  return newElement;
}

export { genericRenderer, htmlToFragment, replaceKeepingFocus };
