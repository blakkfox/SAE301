import { AuthData } from "../../data/auth.js";
import { CartData } from "../../data/cart.js";
import { CategoryData } from "../../data/category.js";
import { ProductData } from "../../data/product.js";
import { bindSkipLink, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { HeaderView } from "../../ui/header/index.js";
import { FooterView } from "../../ui/footer/index.js";
import { PromoBannerView } from "../../ui/promo-banner/index.js";
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
 * Le compte (SUI-b) affiche « Mon compte » hors connexion, sinon le prénom,
 * qui ouvre un menu déroulant : « Mes informations », « Mes commandes »,
 * « Déconnexion ». Le compte est demandé une seule fois à l'API, puis tenu à
 * jour par AuthData.subscribe (connexion, déconnexion, prénom modifié). Une
 * déconnexion depuis ce menu ramène au catalogue : la page affichée pouvait
 * montrer des données du compte.
 *
 * Le bandeau de la promotion automatique (PRO-c), sous l'en-tête, est
 * redemandé à chaque navigation : la promotion suit les stocks, une commande
 * peut la faire changer. La dernière promotion connue s'affiche tout de
 * suite, puis le bandeau est mis à jour dès que l'API répond. Le lien
 * « Promotions » de l'en-tête mène à la même fiche, et disparaît avec le
 * bandeau quand il n'y a pas de promotion.
 *
 * La recherche de l'en-tête mène au catalogue filtré (« /?q=casque ») ; le
 * champ reprend la recherche de l'adresse affichée.
 *
 * Découpage MVC strict, comme une page :
 *   M — catégories du menu, état ouvert / fermé des deux menus, nombre
 *       d'articles du panier, compte connecté, déconnexion, promotion,
 *       recherche en cours ;
 *   V — construction du DOM, ouverture du panneau, écouteurs ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Page affichée après une déconnexion depuis le menu du compte.
const AFTER_LOGOUT_PATH = "/";

// Page des résultats de la recherche : le catalogue, filtré par ?q=….
const SEARCH_PATH = "/";

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
  customer: null, // compte connecté ({ firstName… }), ou null
  accountStatus: "idle", // compte : "idle" (à demander), "loading" ou "known"
  isWatchingAccount: false, // le modèle est abonné aux changements de compte
  isAccountMenuOpen: false, // le menu du compte est ouvert
  isLoggingOut: false, // une déconnexion est en cours
  promotion: null, // produit en promotion automatique ({ id, name, discountRate… }), ou null
  isLoadingPromotion: false, // un chargement de la promotion est en cours
  search: "", // recherche de l'adresse affichée (?q=…), ou chaîne vide
};

/**
 * Retient la recherche de l'adresse affichée, que le champ de l'en-tête reprend.
 *
 * @param {string|undefined} search - Paramètre q de l'adresse.
 */
M.setSearch = function (search) {
  M.search = (search ?? "").trim();
};

/**
 * Chemin de la page des résultats d'une recherche.
 *
 * @param {string} search - Texte saisi dans le champ de l'en-tête.
 * @returns {string} « /?q=… », ou le catalogue entier si la saisie est vide.
 */
M.getSearchPath = function (search) {
  let query = search.trim();
  return query === "" ? SEARCH_PATH : `${SEARCH_PATH}?${new URLSearchParams({ q: query })}`;
};

/**
 * @returns {boolean} true s'il faut redemander la promotion : à chaque
 *   navigation, sauf si une demande est déjà en cours.
 */
M.needsPromotion = function () {
  return !M.isLoadingPromotion;
};

/**
 * Demande la promotion du moment. En cas d'échec, la dernière promotion
 * connue reste affichée : la navigation suivante redemandera.
 *
 * @returns {Promise<void>}
 */
M.loadPromotion = async function () {
  M.isLoadingPromotion = true;

  try {
    let response = await ProductData.fetchPromotion();
    M.promotion = response.promotion;
  } catch (error) {
    // Rien à afficher : le bandeau est un complément, pas un contenu de la page.
  }

  M.isLoadingPromotion = false;
};

/**
 * @returns {?{text: string, url: string}} Le bandeau : la phrase de la
 *   maquette et la fiche du produit, ou null sans promotion.
 */
M.getPromotionData = function () {
  if (M.promotion === null) return null;

  return {
    text: `Promo du moment : −${M.promotion.discountRate} % sur ${M.promotion.name}, notre produit le plus en stock`,
    url: `/produits/${M.promotion.slug}`,
  };
};

/**
 * Demande à être prévenu de chaque changement du compte connecté.
 * L'abonnement n'est pris qu'une fois, comme pour le panier.
 *
 * @param {(customer: ?Object) => void} listener - Fonction à appeler (un handler de C).
 */
M.watchAccount = function (listener) {
  if (M.isWatchingAccount) return;
  AuthData.subscribe(listener);
  M.isWatchingAccount = true;
};

/**
 * @returns {boolean} true s'il faut demander à l'API qui est connecté.
 */
M.needsAccount = function () {
  return M.accountStatus === "idle";
};

/**
 * Demande qui est connecté. En cas d'échec, le lien reste « Mon compte » et
 * la navigation suivante redemandera. Une connexion ou une déconnexion
 * signalée pendant la requête l'emporte sur sa réponse.
 *
 * @returns {Promise<void>}
 */
M.loadAccount = async function () {
  M.accountStatus = "loading";

  try {
    let response = await AuthData.fetchCurrent();
    if (M.accountStatus !== "loading") return;
    M.customer = response.customer;
    M.accountStatus = "known";
  } catch (error) {
    if (M.accountStatus === "loading") M.accountStatus = "idle";
  }
};

/**
 * @param {?Object} customer - Le compte connecté, ou null.
 */
M.setAccount = function (customer) {
  M.customer = customer;
  M.accountStatus = "known";
  if (customer === null) M.isAccountMenuOpen = false;
};

/**
 * Ouvre ou ferme le menu du compte. Un seul menu de l'en-tête est ouvert à
 * la fois : celui des catégories se ferme.
 */
M.toggleAccountMenu = function () {
  M.isAccountMenuOpen = !M.isAccountMenuOpen;
  M.isMenuOpen = false;
};

/**
 * Déconnexion. Même si l'API échoue, on quitte la page : celle qui s'affiche
 * ensuite relit l'état de la session (comme le layout de l'administration).
 * En cas de succès, AuthData prévient l'abonné du compte (C.handler_accountChange).
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
  M.isAccountMenuOpen = false;
};

/**
 * @returns {{firstName: ?string, isOpen: boolean, logoutLabel: string, isLoggingOut: boolean}}
 *   Le compte de l'en-tête : prénom du compte connecté (« Matthias »), ou null
 *   pour afficher « Mon compte ».
 */
M.getAccountData = function () {
  return {
    firstName: M.customer === null ? null : M.customer.firstName,
    isOpen: M.isAccountMenuOpen,
    logoutLabel: M.isLoggingOut ? "Déconnexion…" : "Déconnexion",
    isLoggingOut: M.isLoggingOut,
  };
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
 * Point d'entrée, appelé par le routeur à chaque navigation. Les menus
 * repartent fermés : la page a changé.
 *
 * @param {{q?: string}} params - Paramètres de l'adresse (q : recherche en cours).
 * @returns {DocumentFragment} Le layout, dont le slot sans nom reçoit la page.
 */
C.init = function (params) {
  M.isMenuOpen = false;
  M.isAccountMenuOpen = false;
  M.setSearch(params.q);
  M.loadCartCount();
  M.watchCart(C.handler_cartChange);
  M.watchAccount(C.handler_accountChange);
  let fragment = V.init(M.getMenuData(), M.cartCount, M.getAccountData(), M.getPromotionData(), M.search);

  if (M.needsPromotion()) {
    C.loadPromotion();
  }
  if (M.needsCategories()) {
    C.loadMenu();
  }
  if (M.needsAccount()) {
    C.loadAccount();
  }
  return fragment;
};

/**
 * Demande la promotion du moment, puis met à jour le bandeau.
 *
 * @returns {Promise<void>}
 */
C.loadPromotion = async function () {
  await M.loadPromotion();
  V.renderPromotion(M.getPromotionData());
};

/**
 * Demande qui est connecté, puis met à jour le compte de l'en-tête.
 *
 * @returns {Promise<void>}
 */
C.loadAccount = async function () {
  await M.loadAccount();
  V.renderAccount(M.getAccountData());
};

/**
 * Le compte connecté a changé (connexion, déconnexion, prénom modifié) : le
 * compte de l'en-tête est mis à jour.
 *
 * @param {?Object} customer - Le compte connecté, ou null.
 */
C.handler_accountChange = function (customer) {
  M.setAccount(customer);
  V.renderAccount(M.getAccountData());
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
  M.isAccountMenuOpen = false;
  V.renderMenuState(M.isMenuOpen);
  V.renderAccount(M.getAccountData());
};

/**
 * Clic sur le prénom : ouvre ou ferme le menu du compte.
 */
C.handler_toggleAccountMenu = function () {
  M.toggleAccountMenu();
  V.renderMenuState(M.isMenuOpen);
  V.renderAccount(M.getAccountData());
};

/**
 * « Déconnexion » dans le menu du compte : retour au catalogue ensuite.
 *
 * @returns {Promise<void>}
 */
C.handler_logout = async function () {
  if (M.isLoggingOut) return;

  let logout = M.logout();
  V.renderAccount(M.getAccountData());
  await logout;

  V.renderAccount(M.getAccountData());
  V.goTo(AFTER_LOGOUT_PATH);
};

/**
 * Recherche envoyée depuis l'en-tête : affiche le catalogue filtré.
 *
 * @param {string} search - Texte saisi.
 */
C.handler_search = function (search) {
  V.goTo(M.getSearchPath(search));
};

/**
 * Clic n'importe où dans le document : ferme chaque menu si le clic a eu
 * lieu en dehors de son bouton et de son panneau.
 *
 * @param {MouseEvent} ev
 */
C.handler_clickDocument = function (ev) {
  if (M.isMenuOpen && ev.target.closest("[data-category-menu], [data-category-menu-button]") === null) {
    M.isMenuOpen = false;
    V.renderMenuState(false);
  }
  if (M.isAccountMenuOpen && ev.target.closest("[data-account-dropdown]") === null) {
    M.isAccountMenuOpen = false;
    V.renderAccount(M.getAccountData());
  }
};

/**
 * Touche Échap : ferme le menu ouvert et rend le focus à son bouton.
 *
 * @param {KeyboardEvent} ev
 */
C.handler_keydown = function (ev) {
  if (ev.key !== "Escape") return;

  if (M.isMenuOpen) {
    M.isMenuOpen = false;
    V.renderMenuState(false);
    V.focusMenuButton();
  }
  if (M.isAccountMenuOpen) {
    M.isAccountMenuOpen = false;
    V.renderAccount(M.getAccountData());
    V.focusAccountButton();
  }
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  menuButton: null, // bouton « Catégories » de l'en-tête affiché
  menuPanel: null, // panneau du menu de l'en-tête affiché
  cartCount: null, // compteur « Panier (n) » de l'en-tête affiché
  account: null, // compte de l'en-tête affiché (lien ou menu déroulant)
  promoBanner: null, // conteneur du bandeau de la promotion affiché
  promoLink: null, // lien « Promotions » de l'en-tête affiché (dans son <li>)
  hasDocumentListeners: false, // les écouteurs du document sont posés
};

/**
 * Construit le layout et retient le bouton et le panneau du menu. Les
 * écouteurs du document ne sont posés qu'une fois : le layout est reconstruit
 * à chaque navigation, ils s'accumuleraient.
 *
 * @param {ReturnType<typeof M.getMenuData>} menu - Données du menu.
 * @param {number} cartCount - Nombre d'articles du panier.
 * @param {ReturnType<typeof M.getAccountData>} account - Compte de l'en-tête.
 * @param {ReturnType<typeof M.getPromotionData>} promotion - Bandeau de la promotion.
 * @param {string} search - Recherche en cours, reprise dans le champ de l'en-tête.
 * @returns {DocumentFragment}
 */
V.init = function (menu, cartCount, account, promotion, search) {
  let layout = htmlToFragment(template);

  let header = HeaderView.dom(menu, cartCount, account, search, {
    onToggleMenu: C.handler_toggleMenu,
    onToggleAccount: C.handler_toggleAccountMenu,
    onLogout: C.handler_logout,
    onSearch: C.handler_search,
  });
  V.menuButton = header.querySelector("[data-category-menu-button]");
  V.menuPanel = header.querySelector("[data-category-menu]");
  V.cartCount = header.querySelector("[data-cart-count]");
  V.account = header.querySelector("[data-account-dropdown]");
  V.promoLink = header.querySelector("[data-promo-link]");
  layout.querySelector('slot[name="header"]').replaceWith(header);

  layout.querySelector('slot[name="footer"]').replaceWith(FooterView.dom());
  bindSkipLink(layout);

  V.promoBanner = layout.querySelector("[data-promo-banner]");
  V.renderPromotion(promotion);

  // Nouvelle page : le menu repart fermé, la page défile de nouveau.
  document.documentElement.classList.remove("max-xl:overflow-hidden");

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
 * Affiche le bandeau de la promotion et le lien « Promotions » de l'en-tête,
 * qui mène à la même fiche ; les masque s'il n'y a pas de promotion.
 *
 * @param {ReturnType<typeof M.getPromotionData>} promotion
 */
V.renderPromotion = function (promotion) {
  V.promoLink.hidden = promotion === null;

  if (promotion === null) {
    V.promoBanner.replaceChildren();
    return;
  }
  V.promoLink.querySelector("a").setAttribute("href", promotion.url);
  V.promoBanner.replaceChildren(PromoBannerView.dom(promotion));
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
 * Affiche le menu ouvert ou fermé. Sous xl, le menu couvre l'écran : la page
 * derrière ne défile pas tant qu'il est ouvert (classe sur <html>, qui
 * survit aux changements de page : V.init la retire).
 *
 * @param {boolean} isOpen
 */
V.renderMenuState = function (isOpen) {
  V.menuButton.setAttribute("aria-expanded", String(isOpen));
  V.menuPanel.hidden = !isOpen;
  document.documentElement.classList.toggle("max-xl:overflow-hidden", isOpen);
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
 * Reconstruit le compte de l'en-tête : « Mon compte », ou le prénom et son
 * menu, ouvert ou fermé.
 *
 * @param {ReturnType<typeof M.getAccountData>} account
 */
V.renderAccount = function (account) {
  V.account = replaceKeepingFocus(
    V.account,
    HeaderView.account(account, { onToggleAccount: C.handler_toggleAccountMenu, onLogout: C.handler_logout }),
  );
};

/**
 * Rend le focus au prénom (bouton du menu du compte).
 */
V.focusAccountButton = function () {
  V.account.querySelector('[data-action="toggle"]')?.focus();
};

/**
 * Change de page sans recharger, comme V.goTo du layout de l'administration.
 *
 * @param {string} path - Chemin de route, par exemple « / ».
 */
V.goTo = function (path) {
  window.history.pushState(null, "", import.meta.env.BASE_URL + path.replace(/^\//, ""));
  window.dispatchEvent(new PopStateEvent("popstate"));
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
 * @param {{q?: string}} params - Paramètres de l'adresse.
 * @returns {DocumentFragment}
 */
export function RootLayout(params) {
  return C.init(params);
}
