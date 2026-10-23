import { AuthData } from "../../data/auth.js";
import { bindSkipLink, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { AdminSidebarView } from "../../ui/admin-sidebar/index.js";
import template from "./template.html?raw";

/**
 * Layout de l'administration — US GOF-b (écran Figma n° 10), routes /admin…
 *
 * Remplace l'en-tête et le pied de page du site par le menu latéral noir. Le
 * routeur choisit ce layout pour toute adresse qui commence par /admin (plus
 * long préfixe), et l'appelle à chaque navigation, sans l'attendre : il rend
 * donc tout de suite.
 *
 * « Déconnexion » ferme la session puis revient au tableau de bord, qui
 * affiche alors la connexion administrateur.
 *
 * Découpage MVC strict :
 *   M — déconnexion en cours, appel à l'API ;
 *   V — construction du DOM, navigation ;
 *   C — réaction au clic, seul lien entre M et V.
 */

// Page affichée après la déconnexion.
const AFTER_LOGOUT_PATH = "/admin";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  isLoggingOut: false, // une déconnexion est en cours
};

/**
 * Déconnexion. Même si l'API échoue, on revient au tableau de bord : c'est
 * le serveur qui dira alors si la session est encore ouverte.
 *
 * @returns {Promise<void>}
 */
M.logout = async function () {
  M.isLoggingOut = true;

  try {
    await AuthData.logout();
  } catch (error) {
    // Rien à afficher ici : la page suivante relit l'état de la session.
  }

  M.isLoggingOut = false;
};

/**
 * @returns {{isLoggingOut: boolean}} Données du menu latéral.
 */
M.getSidebarData = function () {
  return { isLoggingOut: M.isLoggingOut };
};

// ---------------------------------------------------------------------------
// C — Contrôleur
// ---------------------------------------------------------------------------

let C = {};

/**
 * Point d'entrée, appelé par le routeur à chaque navigation.
 *
 * @returns {DocumentFragment} Le layout, dont le slot sans nom reçoit la page.
 */
C.init = function () {
  return V.init(M.getSidebarData());
};

/**
 * Clic sur « Déconnexion ».
 *
 * @returns {Promise<void>}
 */
C.handler_logout = async function () {
  if (M.isLoggingOut) return;

  let logout = M.logout();
  V.renderSidebar(M.getSidebarData());
  await logout;

  V.goTo(AFTER_LOGOUT_PATH);
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  sidebar: null, // menu latéral affiché
};

/**
 * @param {ReturnType<typeof M.getSidebarData>} sidebarData
 * @returns {DocumentFragment}
 */
V.init = function (sidebarData) {
  let layout = htmlToFragment(template);

  let sidebar = V.createSidebarFragment(sidebarData);
  V.sidebar = sidebar.firstElementChild;
  layout.querySelector('slot[name="sidebar"]').replaceWith(sidebar);
  bindSkipLink(layout);

  return layout;
};

/**
 * Reconstruit le menu latéral (bouton « Déconnexion… » désactivé pendant
 * l'envoi).
 *
 * @param {ReturnType<typeof M.getSidebarData>} sidebarData
 */
V.renderSidebar = function (sidebarData) {
  V.sidebar = replaceKeepingFocus(V.sidebar, V.createSidebarFragment(sidebarData));
};

/**
 * @param {ReturnType<typeof M.getSidebarData>} sidebarData
 * @returns {DocumentFragment} Le menu latéral, relié au contrôleur.
 */
V.createSidebarFragment = function (sidebarData) {
  return AdminSidebarView.dom(sidebarData, { onLogout: C.handler_logout });
};

/**
 * Change de page sans recharger, comme V.goTo de la page Connexion.
 *
 * @param {string} path - Chemin de route, par exemple « /admin ».
 */
V.goTo = function (path) {
  window.history.pushState(null, "", import.meta.env.BASE_URL + path.replace(/^\//, ""));
  window.dispatchEvent(new PopStateEvent("popstate"));
};

/**
 * Layout exporté vers le routeur (voir main.js).
 *
 * @returns {DocumentFragment}
 */
export function AdminLayout() {
  return C.init();
}
