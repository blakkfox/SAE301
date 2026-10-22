import { AccountData } from "../../data/account.js";
import { AuthData } from "../../data/auth.js";
import { formatPrice } from "../../lib/format.js";
import { formatOrderDate, formatOrderNumber, formatPhone, formatPickupLong } from "../../lib/order.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { AccountMenuView } from "../../ui/account-menu/index.js";
import { MessageView } from "../../ui/message/index.js";
import { OrderStatusBadgeView } from "../../ui/order-status-badge/index.js";
import { PasswordChangeFormView } from "../../ui/password-change-form/index.js";
import { ProfileFormView } from "../../ui/profile-form/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateLastOrder from "./last-order.html?raw";
import templateNoOrder from "./no-order.html?raw";
import templateLogin from "./login.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Mon compte » — US SUI-b (écran Figma n° 14), route /compte.
 *
 * L'espace personnel du compte connecté : sa dernière commande (avec un lien
 * vers l'historique de SUI-c), le formulaire « Mes informations » (prénom,
 * nom, e-mail, téléphone, concession préférée) et le formulaire « Mot de
 * passe ».
 *
 * C'est le serveur qui valide toutes les saisies : la page affiche ses
 * erreurs sous les champs concernés. Les mots de passe ne sont jamais gardés
 * dans le modèle : ils passent du formulaire à l'API, c'est tout. Chaque
 * formulaire est reconstruit seul après son envoi : une saisie en cours dans
 * l'autre n'est pas perdue.
 *
 * Découpage MVC strict :
 *   M — compte, saisies, erreurs, messages, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Titre de la page quand le prénom n'est pas connu (non connecté, erreur).
const DEFAULT_TITLE = "Mon compte";

const SERVER_DOWN = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  account: null, // { customer, dealerships, lastOrder } renvoyé par l'API, ou null
  state: "ready", // "ready", "login" ou "error"
  errorMessage: "", // message de l'état "error"
  notice: null, // { type, texte } au-dessus du contenu (déconnexion), ou null
  isLoggingOut: false, // la déconnexion est en cours
  profile: null, // { values, errors, notice, isSubmitting } du formulaire « Mes informations »
  password: null, // { errors, notice, isSubmitting } du formulaire « Mot de passe »
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.account = null;
  M.state = "ready";
  M.errorMessage = "";
  M.notice = null;
  M.isLoggingOut = false;
  M.profile = null;
  M.password = { errors: {}, notice: null, isSubmitting: false };
};

/**
 * @param {{firstName: string, lastName: string, email: string, phone: string,
 *   preferredDealershipId: ?number}} customer - Compte renvoyé par l'API.
 * @returns {Object} Les valeurs du formulaire « Mes informations ».
 */
M.toProfileValues = function (customer) {
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: formatPhone(customer.phone),
    preferredDealershipId: customer.preferredDealershipId,
  };
};

/**
 * Le compte n'est plus connecté (401) : la page invite à se connecter.
 */
M.setLoggedOut = function () {
  M.state = "login";
  M.account = null;
};

/**
 * Charge le compte, les concessions et la dernière commande.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  try {
    M.account = await AccountData.fetch();
    M.state = "ready";
    M.profile = { values: M.toProfileValues(M.account.customer), errors: {}, notice: null, isSubmitting: false };
  } catch (error) {
    if (error.statut === 401) {
      M.setLoggedOut();
      return;
    }
    M.state = "error";
    M.errorMessage =
      error.statut === undefined ? SERVER_DOWN : `Impossible de charger votre espace personnel : ${error.message}`;
  }
};

/**
 * @param {Error} error - ErreurApi, ou TypeError si le serveur est injoignable.
 * @param {string} action - Ce qui a échoué, pour le message (« l'enregistrement »).
 * @returns {{errors: Object<string, string>, notice: ?{type: string, texte: string}}}
 *   Les erreurs de saisie vont sous leurs champs, une panne dans le message du formulaire.
 */
M.toFormError = function (error, action) {
  if (Object.keys(error.champs ?? {}).length > 0) {
    return { errors: error.champs, notice: null };
  }
  return {
    errors: {},
    notice: { type: "erreur", texte: error.statut === undefined ? SERVER_DOWN : `${action} a échoué : ${error.message}` },
  };
};

/**
 * Début de l'enregistrement des informations : un seul envoi à la fois. Les
 * saisies sont gardées, pour être remises dans le formulaire reconstruit.
 *
 * @param {Object} values - Saisies du formulaire.
 * @returns {boolean} false si un envoi est déjà en cours.
 */
M.startSaveProfile = function (values) {
  if (M.profile.isSubmitting) return false;

  M.profile = { values, errors: {}, notice: null, isSubmitting: true };
  return true;
};

/**
 * Enregistre les informations. À appeler après M.startSaveProfile.
 *
 * @returns {Promise<void>}
 */
M.saveProfile = async function () {
  try {
    let response = await AccountData.update(M.profile.values);
    M.account.customer = response.customer;
    M.profile.values = M.toProfileValues(response.customer);
    M.profile.notice = { type: "succes", texte: "Vos informations sont enregistrées." };
  } catch (error) {
    if (error.statut === 401) {
      M.setLoggedOut();
      return;
    }
    let result = M.toFormError(error, "L’enregistrement");
    M.profile.errors = result.errors;
    M.profile.notice = result.notice;
  } finally {
    M.profile.isSubmitting = false;
  }
};

/**
 * Début du changement de mot de passe : un seul envoi à la fois.
 *
 * @returns {boolean} false si un envoi est déjà en cours.
 */
M.startChangePassword = function () {
  if (M.password.isSubmitting) return false;

  M.password = { errors: {}, notice: null, isSubmitting: true };
  return true;
};

/**
 * Change le mot de passe. À appeler après M.startChangePassword.
 *
 * @param {{currentPassword: string, password: string, passwordConfirm: string}} change
 * @returns {Promise<void>}
 */
M.changePassword = async function (change) {
  try {
    await AccountData.changePassword(change);
    M.password.notice = { type: "succes", texte: "Votre mot de passe a été modifié." };
  } catch (error) {
    if (error.statut === 401) {
      M.setLoggedOut();
      return;
    }
    let result = M.toFormError(error, "Le changement de mot de passe");
    M.password.errors = result.errors;
    M.password.notice = result.notice;
  } finally {
    M.password.isSubmitting = false;
  }
};

/**
 * Début de la déconnexion : une seule à la fois.
 *
 * @returns {boolean} false si une déconnexion est déjà en cours.
 */
M.startLogout = function () {
  if (M.isLoggingOut) return false;

  M.isLoggingOut = true;
  M.notice = null;
  return true;
};

/**
 * Déconnexion : en cas de succès, la page invite à se reconnecter. À
 * appeler après M.startLogout.
 *
 * @returns {Promise<void>}
 */
M.logout = async function () {
  try {
    await AuthData.logout();
    M.setLoggedOut();
    M.notice = { type: "succes", texte: "Vous êtes déconnecté." };
  } catch (error) {
    M.notice = {
      type: "erreur",
      texte: error.statut === undefined ? SERVER_DOWN : `La déconnexion a échoué : ${error.message}`,
    };
  }

  M.isLoggingOut = false;
};

/**
 * @returns {string} « Bonjour Matthias », ou « Mon compte » hors connexion.
 */
M.getTitle = function () {
  return M.state === "ready" ? `Bonjour ${M.account.customer.firstName}` : DEFAULT_TITLE;
};

/**
 * @returns {?{id: number, number: string, status: string, summary: string}} La dernière
 *   commande, prête à afficher (« CMD-0142 · 13/10/2026 · 473,22 € · retrait aujourd’hui
 *   16 h – 18 h »), ou null si le client n'a jamais commandé. id : lien vers sa page (SUI-a).
 */
M.getLastOrderData = function () {
  let order = M.account.lastOrder;
  if (order === null) return null;

  return {
    id: order.id,
    number: formatOrderNumber(order.id),
    status: order.status,
    summary: [
      formatOrderNumber(order.id),
      formatOrderDate(order.createdAt),
      formatPrice(order.total),
      `retrait ${formatPickupLong(order.pickupStart, order.pickupEnd, order.dayOffset)}`,
    ].join(" · "),
  };
};

/**
 * @returns {Parameters<typeof ProfileFormView.dom>[0]} Le formulaire « Mes informations ».
 */
M.getProfileData = function () {
  return {
    values: M.profile.values,
    dealerships: M.account.dealerships.map((dealership) => ({ id: dealership.id, name: dealership.name })),
    errors: M.profile.errors,
    notice: M.profile.notice,
    isSubmitting: M.profile.isSubmitting,
  };
};

/**
 * @returns {Parameters<typeof PasswordChangeFormView.dom>[0]} Le formulaire « Mot de passe ».
 */
M.getPasswordData = function () {
  return {
    email: M.account.customer.email,
    errors: M.password.errors,
    notice: M.password.notice,
    isSubmitting: M.password.isSubmitting,
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "ready"|"login"|"error", title: string, notice: ?{type: string, texte: string},
 *   errorMessage: string, menu: {current: string, logoutLabel: string, isLoggingOut: boolean},
 *   content: ?{lastOrder: ReturnType<typeof M.getLastOrderData>, profile: ReturnType<typeof M.getProfileData>,
 *     password: ReturnType<typeof M.getPasswordData>}}}
 */
M.getViewData = function () {
  return {
    state: M.state,
    title: M.getTitle(),
    notice: M.notice,
    errorMessage: M.errorMessage,
    menu: {
      current: "informations",
      logoutLabel: M.isLoggingOut ? "Déconnexion…" : "Déconnexion",
      isLoggingOut: M.isLoggingOut,
    },
    content:
      M.state !== "ready"
        ? null
        : { lastOrder: M.getLastOrderData(), profile: M.getProfileData(), password: M.getPasswordData() },
  };
};

// ---------------------------------------------------------------------------
// C — Contrôleur
// ---------------------------------------------------------------------------

let C = {};

/**
 * Point d'entrée de la page, appelé par le routeur.
 *
 * @returns {Promise<DocumentFragment>}
 */
C.init = async function () {
  M.reset();
  await M.load();
  return V.init(M.getViewData());
};

/**
 * « Enregistrer » dans « Mes informations ». Seuls ce formulaire et le titre
 * (le prénom a pu changer) sont reconstruits ; toute la page si le compte a
 * été déconnecté entre-temps (401).
 *
 * @param {Object} values - Saisies transmises par le formulaire.
 * @returns {Promise<void>}
 */
C.handler_saveProfile = async function (values) {
  if (!M.startSaveProfile(values)) return;
  V.renderProfile(M.getProfileData());
  await M.saveProfile();

  if (M.state !== "ready") {
    V.render(M.getViewData());
    return;
  }
  V.renderTitle(M.getTitle());
  V.renderProfile(M.getProfileData());
};

/**
 * « Changer le mot de passe ». Seul ce formulaire est reconstruit ; toute la
 * page si le compte a été déconnecté entre-temps (401).
 *
 * @param {{currentPassword: string, password: string, passwordConfirm: string}} change
 * @returns {Promise<void>}
 */
C.handler_changePassword = async function (change) {
  if (!M.startChangePassword()) return;
  V.renderPassword(M.getPasswordData());
  await M.changePassword(change);

  if (M.state !== "ready") {
    V.render(M.getViewData());
    return;
  }
  V.renderPassword(M.getPasswordData());
};

/**
 * « Déconnexion » dans le menu du compte.
 *
 * @returns {Promise<void>}
 */
C.handler_logout = async function () {
  if (!M.startLogout()) return;
  V.render(M.getViewData());
  await M.logout();
  V.render(M.getViewData());
  V.focusTitle();
};

/**
 * « Réessayer » (état "error").
 *
 * @returns {Promise<void>}
 */
C.handler_retry = async function () {
  await M.load();
  V.render(M.getViewData());
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  title: null, // titre « Bonjour Matthias »
  menu: null, // menu « Mon compte » affiché
  notice: null, // conteneur des messages de la page
  content: null, // contenu affiché : espace personnel, connexion ou erreur
  profile: null, // formulaire « Mes informations » affiché, ou null
  password: null, // formulaire « Mot de passe » affiché, ou null
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let page = htmlToFragment(genericRenderer(template, { title: data.title }));
  V.title = page.querySelector("h1");

  let menu = V.createMenuFragment(data.menu);
  V.menu = menu.firstElementChild;
  page.querySelector('slot[name="menu"]').replaceWith(menu);

  V.notice = page.querySelector("[data-account-notice]");
  V.notice.replaceChildren(MessageView.dom(data.notice));

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit le titre, le menu, les messages et le contenu à partir de l'état.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.render = function (data) {
  V.renderTitle(data.title);
  V.menu = replaceKeepingFocus(V.menu, V.createMenuFragment(data.menu));
  V.notice.replaceChildren(MessageView.dom(data.notice));
  V.content = replaceKeepingFocus(V.content, V.createContentFragment(data));
};

/**
 * @param {string} title - « Bonjour Matthias » : le prénom a pu changer.
 */
V.renderTitle = function (title) {
  V.title.textContent = title;
};

/**
 * @param {ReturnType<typeof M.getProfileData>} profile
 */
V.renderProfile = function (profile) {
  V.profile = replaceKeepingFocus(V.profile, V.createProfileFragment(profile));
};

/**
 * @param {ReturnType<typeof M.getPasswordData>} password
 */
V.renderPassword = function (password) {
  V.password = replaceKeepingFocus(V.password, V.createPasswordFragment(password));
};

/**
 * Donne le focus au titre de la page (après la déconnexion, dont le bouton
 * était devenu inactif).
 */
V.focusTitle = function () {
  V.title.focus();
};

/**
 * @param {ReturnType<typeof M.getViewData>["menu"]} menu
 * @returns {DocumentFragment} Le menu « Mon compte ».
 */
V.createMenuFragment = function (menu) {
  return AccountMenuView.dom(menu, { onLogout: C.handler_logout });
};

/**
 * Construit le contenu de l'état courant, et retient les deux formulaires
 * pour pouvoir les reconstruire seuls.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment}
 */
V.createContentFragment = function (data) {
  V.profile = null;
  V.password = null;

  if (data.state === "login") {
    return htmlToFragment(templateLogin);
  }

  if (data.state === "error" || data.content === null) {
    let fragment = htmlToFragment(genericRenderer(templateError, { message: data.errorMessage }));
    fragment.querySelector('[data-action="retry"]').addEventListener("click", C.handler_retry);
    return fragment;
  }

  let fragment = htmlToFragment(templateContent);
  fragment.querySelector('slot[name="last-order"]').replaceWith(V.createLastOrderFragment(data.content.lastOrder));

  let profile = V.createProfileFragment(data.content.profile);
  V.profile = profile.firstElementChild;
  fragment.querySelector('slot[name="profile"]').replaceWith(profile);

  let password = V.createPasswordFragment(data.content.password);
  V.password = password.firstElementChild;
  fragment.querySelector('slot[name="password"]').replaceWith(password);

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getLastOrderData>} lastOrder
 * @returns {DocumentFragment} « Ma dernière commande », ou l'invitation à commander.
 */
V.createLastOrderFragment = function (lastOrder) {
  if (lastOrder === null) {
    return htmlToFragment(templateNoOrder);
  }

  let fragment = htmlToFragment(genericRenderer(templateLastOrder, lastOrder));
  fragment.querySelector('slot[name="status"]').replaceWith(OrderStatusBadgeView.dom(lastOrder.status));
  return fragment;
};

/**
 * @param {ReturnType<typeof M.getProfileData>} profile
 * @returns {DocumentFragment} Le formulaire « Mes informations ».
 */
V.createProfileFragment = function (profile) {
  return ProfileFormView.dom(profile, { onSave: C.handler_saveProfile });
};

/**
 * @param {ReturnType<typeof M.getPasswordData>} password
 * @returns {DocumentFragment} Le formulaire « Mot de passe ».
 */
V.createPasswordFragment = function (password) {
  return PasswordChangeFormView.dom(password, { onChange: C.handler_changePassword });
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function AccountPage() {
  return C.init();
}
