import { CartData } from "../../data/cart.js";
import { CategoryData } from "../../data/category.js";
import { htmlToFragment } from "../../lib/utils.js";
import { HeaderView } from "../../ui/header/index.js";
import { FooterView } from "../../ui/footer/index.js";
import template from "./template.html?raw";

/**
 * Layout principal : l'en-tête, la page affichée, puis le pied de page.
 *
 * Les slots nommés « header » et « footer » sont remplacés ici. Le slot sans
 * nom est laissé au routeur, qui y place la page.
 *
 * Le routeur appelle RootLayout à chaque navigation, sans l'attendre : le
 * layout doit donc rendre tout de suite. Les catégories du menu de l'en-tête
 * (DEC-a) sont chargées une seule fois puis gardées dans le modèle : seul le
 * tout premier affichage montre « Chargement des catégories… », puis le menu
 * est complété dès que l'API répond.
 *
 * Le compteur « Panier (n) » (CMD-b) est mis à jour à chaque modification du
 * panier, dans cet onglet (CartData.subscribe) comme dans un autre (événement
 * « storage » du navigateur), sans attendre une navigation.
 *
 * Découpage MVC strict, comme une page :
 *   M — catégories du menu, état ouvert / fermé, nombre d'articles du panier ;
 *   V — construction du DOM, ouverture du panneau, écouteurs ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  categories: null, // arbre des catégories, ou null tant qu'il n'est pas chargé
  hasFailed: false, // le dernier chargement a échoué
  isLoading: false, // un chargement est en cours
  isMenuOpen: false, // le menu des catégories est ouvert
  cartCount: 0, // nombre d'articles du panier
  isWatchingCart: false, // le modèle est abonné aux modifications du panier
};

/**
 * Relit le nombre d'articles du panier.
 */
M.loadCartCount = function () {
  M.cartCount = CartData.count();
};

/**
 * Demande à être prévenu de chaque modification du panier. L'abonnement
 * n'est pris qu'une fois : le layout est reconstruit à chaque navigation.
 *
 * @param {() => void} listener - Fonction à appeler (un handler de C).
 */
M.watchCart = function (listener) {
  if (M.isWatchingCart) return;
  CartData.subscribe(listener);
  M.isWatchingCart = true;
};

/**
 * Charge l'arbre des catégories. En cas d'échec, M.categories reste null :
 * la navigation suivante retentera le chargement.
 *
 * @returns {Promise<void>}
 */
M.loadCategories = async function () {
  M.isLoading = true;

  try {
    let response = await CategoryData.fetchAll();
    M.categories = response.categories;
    M.hasFailed = false;
  } catch (error) {
    M.hasFailed = true;
  }

  M.isLoading = false;
};

/**
 * @returns {boolean} true s'il faut lancer le chargement des catégories.
 */
M.needsCategories = function () {
  return M.categories === null && !M.isLoading;
};

/**
 * Nombre de produits accordé.
 *
 * @param {number} count - Nombre de produits.
 * @returns {string} Par exemple « 1 produit » ou « 6 produits ».
 */
M.formatCount = function (count) {
  let label = count > 1 ? "produits" : "produit";
  return `${count} ${label}`;
};

/**
 * Données du menu des catégories : le texte d'état tant que les catégories ne
 * sont pas disponibles, puis les catégories et leurs sous-catégories.
 *
 * @returns {{text: ?string, groups: Array<{name: string, url: string, count: number,
 *   countLabel: string, children: Array<{name: string, url: string}>}>}}
 */
M.getMenuData = function () {
  if (M.categories === null) {
    return {
      text: M.hasFailed ? "Les catégories sont indisponibles pour le moment." : "Chargement des catégories…",
      groups: [],
    };
  }

  return {
    text: null,
    groups: M.categories.map((category) => ({
      name: category.name,
      url: `/categories/${category.slug}`,
      count: category.productCount,
      countLabel: M.formatCount(category.productCount),
      children: category.children.map((child) => ({ name: child.name, url: `/categories/${child.slug}` })),
    })),
  };
};

// ---------------------------------------------------------------------------
// C — Contrôleur
// ---------------------------------------------------------------------------

let C = {};

/**
 * Point d'entrée, appelé par le routeur à chaque navigation. Le menu repart
 * fermé : la page a changé.
 *
 * @returns {DocumentFragment} Le layout, dont le slot sans nom reçoit la page.
 */
C.init = function () {
  M.isMenuOpen = false;
  M.loadCartCount();
  M.watchCart(C.handler_cartChange);
  let fragment = V.init(M.getMenuData(), M.cartCount);

  if (M.needsCategories()) {
    C.loadMenu();
  }
  return fragment;
};

/**
 * Charge les catégories, puis complète le menu de l'en-tête affiché, en
 * gardant son état ouvert ou fermé.
 *
 * @returns {Promise<void>}
 */
C.loadMenu = async function () {
  await M.loadCategories();
  V.renderMenu(M.getMenuData());
  V.renderMenuState(M.isMenuOpen);
};

/**
 * Le panier a changé (dans cet onglet, ou dans un autre : événement
 * « storage ») : le compteur de l'en-tête est mis à jour.
 */
C.handler_cartChange = function () {
  M.loadCartCount();
  V.renderCartCount(M.cartCount);
};

/**
 * Clic sur « Catégories » : ouvre ou ferme le menu.
 */
C.handler_toggleMenu = function () {
  M.isMenuOpen = !M.isMenuOpen;
  V.renderMenuState(M.isMenuOpen);
};

/**
 * Clic n'importe où dans le document : ferme le menu si le clic a eu lieu en
 * dehors du bouton et du panneau.
 *
 * @param {MouseEvent} ev
 */
C.handler_clickDocument = function (ev) {
  if (!M.isMenuOpen) return;
  if (ev.target.closest("[data-category-menu], [data-category-menu-button]") !== null) return;

  M.isMenuOpen = false;
  V.renderMenuState(false);
};

/**
 * Touche Échap : ferme le menu et rend le focus au bouton « Catégories ».
 *
 * @param {KeyboardEvent} ev
 */
C.handler_keydown = function (ev) {
  if (ev.key !== "Escape" || !M.isMenuOpen) return;

  M.isMenuOpen = false;
  V.renderMenuState(false);
  V.focusMenuButton();
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  menuButton: null, // bouton « Catégories » de l'en-tête affiché
  menuPanel: null, // panneau du menu de l'en-tête affiché
  cartCount: null, // compteur « Panier (n) » de l'en-tête affiché
  hasDocumentListeners: false, // les écouteurs du document sont posés
};

/**
 * Construit le layout et retient le bouton et le panneau du menu. Les
 * écouteurs du document ne sont posés qu'une fois : le layout est reconstruit
 * à chaque navigation, ils s'accumuleraient.
 *
 * @param {ReturnType<typeof M.getMenuData>} menu - Données du menu.
 * @param {number} cartCount - Nombre d'articles du panier.
 * @returns {DocumentFragment}
 */
V.init = function (menu, cartCount) {
  let layout = htmlToFragment(template);

  let header = HeaderView.dom(menu, cartCount, { onToggleMenu: C.handler_toggleMenu });
  V.menuButton = header.querySelector("[data-category-menu-button]");
  V.menuPanel = header.querySelector("[data-category-menu]");
  V.cartCount = header.querySelector("[data-cart-count]");
  layout.querySelector('slot[name="header"]').replaceWith(header);

  layout.querySelector('slot[name="footer"]').replaceWith(FooterView.dom());

  if (!V.hasDocumentListeners) {
    document.addEventListener("click", C.handler_clickDocument);
    document.addEventListener("keydown", C.handler_keydown);
    // Panier modifié dans un autre onglet.
    window.addEventListener("storage", C.handler_cartChange);
    V.hasDocumentListeners = true;
  }

  return layout;
};

/**
 * Remplace le contenu du menu par celui reçu (le panneau est recréé fermé).
 *
 * @param {ReturnType<typeof M.getMenuData>} menu - Données du menu.
 */
V.renderMenu = function (menu) {
  let fragment = HeaderView.menu(menu);
  let newPanel = fragment.firstElementChild;
  V.menuPanel.replaceWith(fragment);
  V.menuPanel = newPanel;
};

/**
 * Affiche le menu ouvert ou fermé.
 *
 * @param {boolean} isOpen
 */
V.renderMenuState = function (isOpen) {
  V.menuButton.setAttribute("aria-expanded", String(isOpen));
  V.menuPanel.hidden = !isOpen;
};

/**
 * Affiche le nombre d'articles du panier dans l'en-tête.
 *
 * @param {number} count
 */
V.renderCartCount = function (count) {
  V.cartCount.textContent = String(count);
};

/**
 * Rend le focus au bouton « Catégories ».
 */
V.focusMenuButton = function () {
  V.menuButton.focus();
};

/**
 * Layout exporté vers le routeur (voir main.js).
 *
 * @returns {DocumentFragment}
 */
export function RootLayout() {
  return C.init();
}
