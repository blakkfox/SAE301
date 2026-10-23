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

/**
 * Affiche les erreurs de saisie d'un formulaire, chacune sous son champ.
 *
 * Chaque message a sa place dans le template : un élément
 * data-error-for="email", masqué tant qu'il est vide, que le champ du même
 * nom désigne par aria-describedby. Le champ en erreur reçoit
 * aria-invalid="true" : le lecteur d'écran l'annonce, et la classe .field le
 * borde de rouge.
 *
 * @param {ParentNode} root - Formulaire (ou fragment) qui contient les champs.
 * @param {Object<string, string>} errors - Message de chaque champ en erreur.
 */
function applyFieldErrors(root, errors) {
  for (const element of root.querySelectorAll("[data-error-for]")) {
    let name = element.dataset.errorFor;
    let message = errors[name] ?? null;

    element.textContent = message ?? "";
    element.hidden = message === null;
    root.querySelector(`[name="${name}"]`)?.setAttribute("aria-invalid", String(message !== null));
  }
}

/**
 * Numéro de page lu dans l'adresse (?page=2). Une valeur absente ou invalide
 * donne la première page ; le serveur ramène lui-même une page trop grande à
 * la dernière.
 *
 * @param {string|undefined} value - Valeur du paramètre, telle que lue.
 * @returns {number} Au moins 1.
 */
function toPageNumber(value) {
  let page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/**
 * Inscrit les réglages d'une liste (page, tri, filtre) dans l'adresse, sans
 * recharger : une nouvelle entrée d'historique, pour que « Précédent » revienne
 * aux réglages d'avant et que l'adresse puisse être partagée. Rien n'est
 * ajouté si l'adresse ne change pas.
 *
 * @param {Object<string, string>} query - Paramètres à inscrire ; vide pour aucun.
 */
function pushQuery(query) {
  let search = new URLSearchParams(query).toString();
  let url = window.location.pathname + (search === "" ? "" : `?${search}`);

  if (url !== window.location.pathname + window.location.search) {
    window.history.pushState(null, "", url);
  }
}

/**
 * Corrige le numéro de page de l'adresse, sans nouvelle entrée d'historique :
 * le serveur a pu ramener une page trop grande (?page=99) à la dernière. Les
 * autres paramètres sont gardés ; la première page n'y figure pas.
 *
 * @param {number} page - Page réellement affichée.
 */
function replacePageNumber(page) {
  let params = new URLSearchParams(window.location.search);
  if (page > 1) params.set("page", String(page));
  else params.delete("page");

  let search = params.toString();
  let url = window.location.pathname + (search === "" ? "" : `?${search}`);

  if (url !== window.location.pathname + window.location.search) {
    window.history.replaceState(window.history.state, "", url);
  }
}

/**
 * Relie le lien d'évitement « Aller au contenu » (data-skip-link) d'un
 * layout : il place le focus sur <main id="contenu"> sans changer l'adresse.
 * Une ancre (#contenu) serait vue par le routeur comme une navigation.
 *
 * @param {ParentNode} layout - Fragment du layout, qui contient le lien et <main>.
 */
function bindSkipLink(layout) {
  let main = layout.querySelector("#contenu");

  layout.querySelector("[data-skip-link]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    main.focus();
  });
}

export { genericRenderer, htmlToFragment, replaceKeepingFocus, applyFieldErrors, toPageNumber, pushQuery, replacePageNumber, bindSkipLink };
