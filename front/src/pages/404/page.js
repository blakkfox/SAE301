import template from "./template.html?raw";

/**
 * Page « introuvable », pour toute adresse sans route. Page statique : elle
 * renvoie son template tel quel.
 *
 * @returns {string} Le HTML de la page.
 */
export function The404Page() {
  return template;
}
