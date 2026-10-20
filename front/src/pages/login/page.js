import { AuthData } from "../../data/auth.js";
import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { FormulaireConnexionView } from "../../ui/formulaire-connexion/index.js";
import { MessageView } from "../../ui/message/index.js";
import { PasswordResetFormView } from "../../ui/password-reset-form/index.js";
import { RegisterFormView } from "../../ui/register-form/index.js";
import template from "./template.html?raw";
import templateForms from "./forms.html?raw";
import templateConnected from "./connected.html?raw";

/**
 * Page « Connexion » — US CMD-c (écran Figma n° 5), route /connexion.
 *
 * Deux colonnes : « J'ai déjà un compte » (ou, à sa place, « Mot de passe
 * oublié ») et « Créer un compte ». Une connexion ou une création de compte
 * réussie ramène au panier : c'est de là que partira la validation de la
 * commande (CMD-a). Si l'utilisateur est déjà connecté, la page le dit au lieu
 * d'afficher les formulaires.
 *
 * C'est le serveur qui valide toutes les saisies : la page affiche ses
 * erreurs sous les champs concernés. Les mots de passe ne sont jamais gardés
 * dans le modèle : ils passent du formulaire à l'API, c'est tout.
 *
 * Découpage MVC strict :
 *   M — compte connecté, colonne affichée, saisies, erreurs, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Page affichée après une connexion ou une création de compte réussie.
const AFTER_LOGIN_PATH = "/panier";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  customer: null, // compte connecté, ou null
  panel: "login", // colonne de gauche : "login" ou "reset"
  pending: null, // envoi en cours : "login", "register", "reset", "logout" ou null
  notice: null, // { type, texte } à afficher au-dessus des formulaires, ou null
  login: null, // { email, errors } du formulaire de connexion
  register: null, // { values, errors } du formulaire de création de compte
  resetForm: null, // { email, errors } du formulaire « Mot de passe oublié »
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.customer = null;
  M.panel = "login";
  M.pending = null;
  M.notice = null;
  M.login = { email: "", errors: {} };
  M.register = { values: { firstName: "", lastName: "", email: "", phone: "" }, errors: {} };
  M.resetForm = { email: "", errors: {} };
};

/**
 * Demande à l'API qui est connecté. En cas d'échec, la page affiche les
 * formulaires : une connexion signalera alors elle-même le problème.
 *
 * @returns {Promise<void>}
 */
M.loadCurrent = async function () {
  try {
    let response = await AuthData.fetchCurrent();
    M.customer = response.customer;
  } catch (error) {
    M.customer = null;
  }
};

/**
 * Range l'erreur d'un envoi : les erreurs de saisie vont sous leurs champs,
 * une panne du serveur dans le message de la page.
 *
 * @param {Error} error - Erreur levée par AuthData (ErreurApi, ou TypeError
 *   si le serveur est injoignable).
 * @param {{errors: Object<string, string>}} form - Formulaire concerné.
 * @param {?string} credentialsField - Champ qui reçoit le message d'un 401
 *   (connexion refusée), ou null.
 */
M.storeError = function (error, form, credentialsField) {
  form.errors = {};

  if (error.statut === 401 && credentialsField !== null) {
    form.errors = { [credentialsField]: error.message };
  } else if (error.champs !== undefined && Object.keys(error.champs).length > 0) {
    form.errors = error.champs;
  } else if (error.statut === undefined) {
    M.notice = { type: "erreur", texte: "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez." };
  } else {
    M.notice = { type: "erreur", texte: `Une erreur est survenue : ${error.message}` };
  }
};

/**
 * Début d'un envoi : retient les saisies (hors mots de passe), pour que le
 * formulaire reconstruit pendant l'envoi les garde.
 *
 * @param {"login"|"register"|"reset"|"logout"} kind - Envoi commencé.
 * @param {Object<string, string>} values - Saisies du formulaire.
 * @returns {boolean} false si un autre envoi est déjà en cours.
 */
M.startSubmit = function (kind, values) {
  if (M.pending !== null) return false;

  M.pending = kind;
  if (kind === "login") {
    M.login.email = values.email;
  } else if (kind === "register") {
    M.register.values = {
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      phone: values.phone,
    };
  } else if (kind === "reset") {
    M.resetForm.email = values.email;
  }
  return true;
};

/**
 * Connexion. Comme sur la maquette, un refus s'affiche sous le mot de passe.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<boolean>} true si le compte est connecté.
 */
M.submitLogin = async function (email, password) {
  M.login.errors = {};
  M.notice = null;

  try {
    let response = await AuthData.login(email, password);
    M.customer = response.customer;
    return true;
  } catch (error) {
    M.storeError(error, M.login, "password");
    return false;
  } finally {
    M.pending = null;
  }
};

/**
 * Création de compte. Le compte créé est aussitôt connecté par l'API.
 *
 * @param {{firstName: string, lastName: string, email: string, phone: string,
 *   password: string, passwordConfirm: string}} account
 * @returns {Promise<boolean>} true si le compte est créé et connecté.
 */
M.submitRegister = async function (account) {
  M.register.errors = {};
  M.notice = null;

  try {
    let response = await AuthData.register(account);
    M.customer = response.customer;
    return true;
  } catch (error) {
    M.storeError(error, M.register, null);
    return false;
  } finally {
    M.pending = null;
  }
};

/**
 * Mot de passe oublié. En cas de succès, la colonne revient à la connexion,
 * adresse pré-remplie, avec un message de confirmation.
 *
 * @param {{email: string, password: string, passwordConfirm: string}} reset
 * @returns {Promise<boolean>} true si le mot de passe est modifié.
 */
M.submitReset = async function (reset) {
  M.resetForm.errors = {};
  M.notice = null;

  try {
    await AuthData.resetPassword(reset);
  } catch (error) {
    M.storeError(error, M.resetForm, null);
    return false;
  } finally {
    M.pending = null;
  }

  M.showLogin();
  M.login = { email: reset.email, errors: {} };
  M.notice = { type: "succes", texte: "Votre mot de passe a été modifié. Connectez-vous avec le nouveau." };
  return true;
};

/**
 * Déconnexion. Même si l'API échoue, la page repart sur les formulaires.
 *
 * @returns {Promise<void>}
 */
M.logout = async function () {
  try {
    await AuthData.logout();
    M.customer = null;
  } catch (error) {
    M.storeError(error, M.login, null);
  } finally {
    M.pending = null;
  }
};

/**
 * Affiche « Mot de passe oublié » à la place de la connexion, en reprenant
 * l'adresse déjà saisie.
 *
 * @param {string} email - Adresse saisie dans le formulaire de connexion.
 */
M.showReset = function (email) {
  M.panel = "reset";
  M.notice = null;
  M.resetForm = { email, errors: {} };
};

/**
 * Revient au formulaire de connexion.
 */
M.showLogin = function () {
  M.panel = "login";
  M.notice = null;
};

/**
 * @returns {{email: string, errors: Object<string, string>, isSubmitting: boolean}}
 *   Données du formulaire de connexion.
 */
M.getLoginData = function () {
  return { ...M.login, isSubmitting: M.pending === "login" };
};

/**
 * @returns {{values: Object<string, string>, errors: Object<string, string>,
 *   isSubmitting: boolean}} Données du formulaire de création de compte.
 */
M.getRegisterData = function () {
  return { ...M.register, isSubmitting: M.pending === "register" };
};

/**
 * @returns {{email: string, errors: Object<string, string>, isSubmitting: boolean}}
 *   Données du formulaire « Mot de passe oublié ».
 */
M.getResetData = function () {
  return { ...M.resetForm, isSubmitting: M.pending === "reset" };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "connected"|"forms", panel: "login"|"reset",
 *   customer: ?{firstName: string, email: string, isLoggingOut: boolean, logoutLabel: string},
 *   notice: ?{type: string, texte: string},
 *   login: ReturnType<typeof M.getLoginData>, register: ReturnType<typeof M.getRegisterData>,
 *   reset: ReturnType<typeof M.getResetData>}}
 */
M.getViewData = function () {
  return {
    state: M.customer === null ? "forms" : "connected",
    panel: M.panel,
    customer:
      M.customer === null
        ? null
        : {
            firstName: M.customer.firstName,
            email: M.customer.email,
            isLoggingOut: M.pending === "logout",
            logoutLabel: M.pending === "logout" ? "Déconnexion…" : "Se déconnecter",
          },
    notice: M.notice,
    login: M.getLoginData(),
    register: M.getRegisterData(),
    reset: M.getResetData(),
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
  await M.loadCurrent();
  return V.init(M.getViewData());
};

/**
 * Envoi du formulaire de connexion. Pendant l'envoi, le bouton est désactivé ;
 * en cas d'échec, le focus va au premier champ en erreur.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<void>}
 */
C.handler_login = async function (email, password) {
  if (!M.startSubmit("login", { email })) return;
  V.renderLeft(M.getViewData());

  if (await M.submitLogin(email, password)) {
    V.goTo(AFTER_LOGIN_PATH);
    return;
  }

  V.renderLeft(M.getViewData());
  V.renderNotice(M.notice);
  V.focusFirstError();
};

/**
 * Envoi du formulaire de création de compte.
 *
 * @param {Parameters<typeof M.submitRegister>[0]} account
 * @returns {Promise<void>}
 */
C.handler_register = async function (account) {
  if (!M.startSubmit("register", account)) return;
  V.renderRegister(M.getViewData());

  if (await M.submitRegister(account)) {
    V.goTo(AFTER_LOGIN_PATH);
    return;
  }

  V.renderRegister(M.getViewData());
  V.renderNotice(M.notice);
  V.focusFirstError();
};

/**
 * Clic sur « Mot de passe oublié ? ».
 *
 * @param {string} email - Adresse déjà saisie, reprise dans le formulaire.
 */
C.handler_forgotPassword = function (email) {
  M.showReset(email);
  V.renderLeft(M.getViewData());
  V.renderNotice(M.notice);
  V.focusLeftTitle();
};

/**
 * Clic sur « Retour à la connexion ».
 */
C.handler_cancelReset = function () {
  M.showLogin();
  V.renderLeft(M.getViewData());
  V.renderNotice(M.notice);
  V.focusLoginField("email");
};

/**
 * Envoi du formulaire « Mot de passe oublié ». En cas de succès, retour à la
 * connexion, focus sur le mot de passe : l'adresse est déjà remplie.
 *
 * @param {Parameters<typeof M.submitReset>[0]} reset
 * @returns {Promise<void>}
 */
C.handler_resetPassword = async function (reset) {
  if (!M.startSubmit("reset", reset)) return;
  V.renderLeft(M.getViewData());

  let isReset = await M.submitReset(reset);

  V.renderLeft(M.getViewData());
  V.renderNotice(M.notice);

  if (isReset) {
    V.focusLoginField("password");
  } else {
    V.focusFirstError();
  }
};

/**
 * Clic sur « Se déconnecter » : la page affiche de nouveau les formulaires.
 *
 * @returns {Promise<void>}
 */
C.handler_logout = async function () {
  if (!M.startSubmit("logout", {})) return;
  V.renderContent(M.getViewData());

  await M.logout();
  V.renderContent(M.getViewData());
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  content: null, // zone affichée : les deux colonnes, ou « Vous êtes connecté »
  left: null, // carte de gauche affichée (connexion ou mot de passe oublié), ou null
  register: null, // carte « Créer un compte » affichée, ou null
  notice: null, // conteneur des messages
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let page = htmlToFragment(template);

  V.notice = page.querySelector("[data-login-notice]");
  V.renderNotice(data.notice);

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit toute la zone (après une déconnexion) et les messages.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.renderContent = function (data) {
  let content = V.createContentFragment(data);
  let newContent = content.firstElementChild;
  V.content.replaceWith(content);
  V.content = newContent;

  V.renderNotice(data.notice);
};

/**
 * Reconstruit la carte de gauche seule : ce qui est saisi dans « Créer un
 * compte » n'est pas effacé.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.renderLeft = function (data) {
  let fragment = V.createLeftFragment(data);
  let newLeft = fragment.firstElementChild;
  V.left.replaceWith(fragment);
  V.left = newLeft;
};

/**
 * Reconstruit la carte « Créer un compte » seule.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.renderRegister = function (data) {
  let fragment = V.createRegisterFragment(data);
  let newRegister = fragment.firstElementChild;
  V.register.replaceWith(fragment);
  V.register = newRegister;
};

/**
 * Affiche le message reçu, ou aucun.
 *
 * @param {?{type: string, texte: string}} notice
 */
V.renderNotice = function (notice) {
  V.notice.replaceChildren(MessageView.dom(notice));
};

/**
 * Donne le focus au premier champ en erreur de la page, s'il y en a un.
 */
V.focusFirstError = function () {
  V.content.querySelector('[aria-invalid="true"]')?.focus();
};

/**
 * Donne le focus au titre de la carte de gauche (« Mot de passe oublié ») :
 * le bouton utilisé a disparu avec l'ancienne carte.
 */
V.focusLeftTitle = function () {
  V.left.querySelector("h2").focus();
};

/**
 * @param {string} name - Nom d'un champ du formulaire de connexion.
 */
V.focusLoginField = function (name) {
  V.left.querySelector(`[name="${name}"]`)?.focus();
};

/**
 * Change de page sans recharger : l'adresse est remplacée, puis le routeur
 * est prévenu comme pour le bouton Précédent (événement popstate, qu'il
 * écoute déjà).
 *
 * @param {string} path - Chemin de route, par exemple « /panier ».
 */
V.goTo = function (path) {
  window.history.pushState(null, "", import.meta.env.BASE_URL + path.replace(/^\//, ""));
  window.dispatchEvent(new PopStateEvent("popstate"));
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} Les deux colonnes, ou « Vous êtes connecté ».
 */
V.createContentFragment = function (data) {
  V.left = null;
  V.register = null;

  if (data.state === "connected") {
    let fragment = htmlToFragment(genericRenderer(templateConnected, data.customer));
    let button = fragment.querySelector('[data-action="logout"]');
    button.disabled = data.customer.isLoggingOut;
    button.addEventListener("click", C.handler_logout);
    return fragment;
  }

  let fragment = htmlToFragment(templateForms);

  let left = V.createLeftFragment(data);
  V.left = left.firstElementChild;
  fragment.querySelector('slot[name="left"]').replaceWith(left);

  let register = V.createRegisterFragment(data);
  V.register = register.firstElementChild;
  fragment.querySelector('slot[name="register"]').replaceWith(register);

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} « J'ai déjà un compte » ou « Mot de passe oublié ».
 */
V.createLeftFragment = function (data) {
  if (data.panel === "reset") {
    return PasswordResetFormView.dom(data.reset, {
      onReset: C.handler_resetPassword,
      onCancel: C.handler_cancelReset,
    });
  }

  return FormulaireConnexionView.dom(data.login, {
    surConnexion: C.handler_login,
    onForgotPassword: C.handler_forgotPassword,
  });
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} « Créer un compte », relié au contrôleur.
 */
V.createRegisterFragment = function (data) {
  return RegisterFormView.dom(data.register, { onRegister: C.handler_register });
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function LoginPage() {
  return C.init();
}
