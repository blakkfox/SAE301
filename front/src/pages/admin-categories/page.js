import { AdminData } from "../../data/admin.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { CategoryFormView } from "../../ui/category-form/index.js";
import { MessageView } from "../../ui/message/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateTable from "./table.html?raw";
import templateRow from "./row.html?raw";
import templateEmpty from "./empty.html?raw";
import templateDeleteBlocked from "./delete-blocked.html?raw";
import templateDeleteConfirm from "./delete-confirm.html?raw";
import templateLogin from "./login.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Gestion des catégories » — US GOF-c (écran Figma n° 12), route
 * /admin/categories.
 *
 * Toutes les catégories, masquées comprises, avec leurs sous-catégories en
 * retrait. Le formulaire de droite crée une catégorie (« Nouvelle
 * catégorie ») ou modifie celle choisie (« Modifier ») : nom, description,
 * parente, visibilité. « Supprimer » demande confirmation pour une catégorie
 * vide, et explique le refus sinon.
 *
 * Le serveur décide de tout : accès (401, 403), validation et nom unique
 * (422, 409), suppression d'une catégorie vide seulement (409). La page
 * anticipe le refus de suppression pour l'expliquer sans attendre, mais
 * c'est la réponse du serveur qui fait foi.
 *
 * Découpage MVC strict :
 *   M — catégories, formulaire, suppression, état de la page, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Valeurs d'un formulaire vide (« Nouvelle catégorie »).
const EMPTY_VALUES = { name: "", description: "", isVisible: true, parentId: null };

// Classes de la colonne Nom, écrites en entier.
const NAME_CLASSES = {
  parent: "pl-5 font-semibold",
  child: "pl-10 font-normal",
};

// Pastille de visibilité, classes écrites en entier. Le texte reste en gris
// anthracite : le vert Statut/Succès n'est pas assez contrasté pour du texte.
const VISIBILITY = {
  visible: { label: "Visible", badgeClass: "bg-success-soft" },
  hidden: { label: "Masquée", badgeClass: "bg-line" },
  hiddenByParent: { label: "Masquée (parente)", badgeClass: "bg-line" },
};

const SERVER_DOWN = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  response: null, // réponse de GET /api/admin/categories, ou null
  state: "list", // "list", "login" ou "error"
  errorMessage: "", // message de l'état "error"
  notice: null, // { type, texte } au-dessus du contenu, ou null
  editId: null, // catégorie en cours de modification, ou null (création)
  values: null, // saisie du formulaire { name, description, isVisible, parentId }
  errors: {}, // erreurs du formulaire, par champ
  isSubmitting: false, // un enregistrement est en cours
  deletion: null, // { id, name, blockedMessage } : suppression demandée, ou null
  isDeleting: false, // une suppression est en cours
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.response = null;
  M.state = "list";
  M.errorMessage = "";
  M.notice = null;
  M.isSubmitting = false;
  M.isDeleting = false;
  M.startCreate();
};

/**
 * Refus du serveur (401, 403) : la page affiche la connexion.
 *
 * @param {ErreurApi} error
 * @returns {boolean} true si l'erreur était un refus d'accès.
 */
M.handleAccessError = function (error) {
  if (error.statut !== 401 && error.statut !== 403) return false;

  M.state = "login";
  M.notice =
    error.statut === 403
      ? { type: "erreur", texte: "Vous êtes connecté avec un compte client. Connectez-vous avec un compte administrateur." }
      : null;
  return true;
};

/**
 * Charge les catégories. Si la catégorie modifiée a disparu, le formulaire
 * repasse en création.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  try {
    M.response = await AdminData.fetchCategories();
    M.state = "list";
    if (M.editId !== null && M.findCategory(M.editId) === null) M.startCreate();
  } catch (error) {
    if (M.handleAccessError(error)) return;

    let message = error.statut === undefined ? SERVER_DOWN : `Impossible de charger les catégories : ${error.message}`;
    if (M.response === null) {
      M.state = "error";
      M.errorMessage = message;
    } else {
      M.notice = { type: "erreur", texte: message };
    }
  }
};

/**
 * @returns {Array<Object>} Toutes les catégories, chaque parente suivie de
 *   ses sous-catégories.
 */
M.flatCategories = function () {
  return M.response.categories.flatMap((parent) => [parent, ...parent.children]);
};

/**
 * @param {number} id
 * @returns {?Object} La catégorie (avec children si elle est de premier niveau), ou null.
 */
M.findCategory = function (id) {
  return M.flatCategories().find((category) => category.id === id) ?? null;
};

/**
 * Formulaire vide, en création.
 */
M.startCreate = function () {
  M.editId = null;
  M.values = { ...EMPTY_VALUES };
  M.errors = {};
  M.deletion = null;
};

/**
 * Formulaire rempli avec la catégorie choisie.
 *
 * @param {number} id
 */
M.startEdit = function (id) {
  let category = M.findCategory(id);
  if (category === null) return;

  M.editId = id;
  M.values = {
    name: category.name,
    description: category.description ?? "",
    isVisible: category.isVisible,
    parentId: category.parentId,
  };
  M.errors = {};
  M.deletion = null;
};

/**
 * Garde la saisie en cours, pour qu'une reconstruction de la page ne l'efface pas.
 *
 * @param {{name: string, description: string, isVisible: boolean, parentId: ?number}} values
 */
M.setValues = function (values) {
  M.values = values;
};

/**
 * Début d'un enregistrement.
 *
 * @param {Object} values - Saisie envoyée.
 * @returns {boolean} false si un enregistrement est déjà en cours.
 */
M.startSubmit = function (values) {
  if (M.isSubmitting) return false;

  M.isSubmitting = true;
  M.values = values;
  M.notice = null;
  return true;
};

/**
 * Enregistre la saisie (création ou modification), puis recharge la liste.
 * Réussi, le formulaire repasse en création ; refusé, les erreurs
 * s'affichent sous leur champ.
 *
 * @returns {Promise<boolean>} true si la catégorie est enregistrée.
 */
M.submit = async function () {
  let isCreation = M.editId === null;
  let isSaved = false;

  try {
    let response = isCreation
      ? await AdminData.createCategory(M.values)
      : await AdminData.updateCategory(M.editId, M.values);

    M.notice = {
      type: "succes",
      texte: `Catégorie « ${response.category.name} » ${isCreation ? "créée" : "enregistrée"}.`,
    };
    M.startCreate();
    isSaved = true;
  } catch (error) {
    if (!M.handleAccessError(error)) {
      if (error.statut === 422 || error.statut === 409) {
        M.errors = error.champs;
      } else if (error.statut === 404) {
        M.notice = { type: "erreur", texte: "Cette catégorie n’existe plus." };
        M.startCreate();
      } else {
        M.notice = { type: "erreur", texte: error.statut === undefined ? SERVER_DOWN : `Enregistrement impossible : ${error.message}` };
      }
    }
  }

  if (M.state === "list") await M.load();
  M.isSubmitting = false;
  return isSaved;
};

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string} « 1 produit », « 6 produits »…
 */
M.formatCount = function (count, singular, plural) {
  return `${count} ${count > 1 ? plural : singular}`;
};

/**
 * Demande de suppression : la confirmation pour une catégorie vide, le
 * refus expliqué sinon (même message que le serveur).
 *
 * @param {number} id
 */
M.askDelete = function (id) {
  let category = M.findCategory(id);
  if (category === null) return;

  let childCount = category.children?.length ?? 0;
  let blockedMessage = null;

  if (category.productCount > 0) {
    blockedMessage = `Suppression impossible : ${M.formatCount(category.productCount, "produit est encore rangé", "produits sont encore rangés")} dans ${category.name}.`;
  } else if (childCount > 0) {
    blockedMessage = `Suppression impossible : ${category.name} contient encore ${M.formatCount(childCount, "sous-catégorie", "sous-catégories")}.`;
  }

  M.deletion = { id, name: category.name, blockedMessage };
  M.notice = null;
};

/**
 * Referme la demande de suppression.
 */
M.closeDelete = function () {
  M.deletion = null;
};

/**
 * Début de la suppression confirmée.
 *
 * @returns {boolean} false si rien n'est à supprimer ou si une suppression est en cours.
 */
M.startDelete = function () {
  if (M.isDeleting || M.deletion === null || M.deletion.blockedMessage !== null) return false;

  M.isDeleting = true;
  return true;
};

/**
 * Supprime la catégorie confirmée, puis recharge la liste. Un refus du
 * serveur (409 : elle n'est plus vide) remplace la confirmation.
 *
 * @returns {Promise<void>}
 */
M.confirmDelete = async function () {
  let { id, name } = M.deletion;

  try {
    await AdminData.deleteCategory(id);
    M.notice = { type: "succes", texte: `Catégorie « ${name} » supprimée.` };
    M.deletion = null;
    if (M.editId === id) M.startCreate();
  } catch (error) {
    if (!M.handleAccessError(error)) {
      if (error.statut === 409) {
        M.deletion = { id, name, blockedMessage: error.message };
      } else {
        M.deletion = null;
        M.notice = {
          type: "erreur",
          texte:
            error.statut === 404
              ? "Cette catégorie n’existe plus."
              : error.statut === undefined
                ? SERVER_DOWN
                : `Suppression impossible : ${error.message}`,
        };
      }
    }
  }

  if (M.state === "list") await M.load();
  M.isDeleting = false;
};

/**
 * @param {Object} category
 * @param {?Object} parent - Sa parente, ou null pour le premier niveau.
 * @returns {Object} Une ligne du tableau, prête à afficher.
 */
M.toRow = function (category, parent) {
  let visibility =
    !category.isVisible ? VISIBILITY.hidden : parent !== null && !parent.isVisible ? VISIBILITY.hiddenByParent : VISIBILITY.visible;

  return {
    id: category.id,
    name: category.name,
    parentName: parent === null ? "" : parent.name,
    nameClass: parent === null ? NAME_CLASSES.parent : NAME_CLASSES.child,
    productCount: category.productCount,
    visibility: visibility.label,
    badgeClass: visibility.badgeClass,
    isEditing: category.id === M.editId,
  };
};

/**
 * @returns {Array<ReturnType<typeof M.toRow>>} Les lignes, chaque parente suivie de ses sous-catégories.
 */
M.getRows = function () {
  return M.response.categories.flatMap((parent) => [
    M.toRow(parent, null),
    ...parent.children.map((child) => M.toRow(child, parent)),
  ]);
};

/**
 * @returns {Object} Données du formulaire (CategoryFormView).
 */
M.getFormData = function () {
  let edited = M.editId === null ? null : M.findCategory(M.editId);
  // Une catégorie qui a des sous-catégories reste au premier niveau.
  let isParentLocked = (edited?.children?.length ?? 0) > 0;

  return {
    title: edited === null ? "Nouvelle catégorie" : "Modifier la catégorie",
    values: M.values,
    parentOptions: M.response.categories
      .filter((category) => category.id !== M.editId)
      .map((category) => ({ id: category.id, name: category.name })),
    isParentLocked,
    parentHint: isParentLocked
      ? "Elle a des sous-catégories : elle reste au premier niveau."
      : "Une sous-catégorie masquée, ou dont la parente est masquée, n’apparaît pas dans la boutique.",
    errors: M.errors,
    isSubmitting: M.isSubmitting,
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "list"|"login"|"error", notice: ?{type: string, texte: string}, errorMessage: string,
 *   content: ?{adminLabel: string, rows: ReturnType<typeof M.getRows>, caption: string,
 *     form: ReturnType<typeof M.getFormData>,
 *     deletion: ?{name: string, blockedMessage: ?string, confirmLabel: string, isDeleting: boolean}}}}
 */
M.getViewData = function () {
  if (M.state !== "list" || M.response === null) {
    return { state: M.state, notice: M.notice, errorMessage: M.errorMessage, content: null };
  }

  let rows = M.getRows();

  return {
    state: M.state,
    notice: M.notice,
    errorMessage: M.errorMessage,
    content: {
      adminLabel: `${M.response.admin.firstName} (admin) · Lyon Centre`,
      rows,
      caption: M.formatCount(rows.length, "catégorie", "catégories"),
      form: M.getFormData(),
      deletion:
        M.deletion === null
          ? null
          : {
              name: M.deletion.name,
              blockedMessage: M.deletion.blockedMessage,
              confirmLabel: M.isDeleting ? "Suppression…" : "Confirmer la suppression",
              isDeleting: M.isDeleting,
            },
    },
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
 * « + Nouvelle catégorie » : formulaire vide, focus sur le nom.
 */
C.handler_new = function () {
  M.startCreate();
  V.render(M.getViewData());
  V.focusKey("category-name");
};

/**
 * « Modifier » sur une ligne : formulaire rempli, focus sur le nom.
 *
 * @param {number} id
 */
C.handler_edit = function (id) {
  M.startEdit(id);
  V.render(M.getViewData());
  V.focusKey("category-name");
};

/**
 * Saisie dans le formulaire : gardée, sans reconstruire la page.
 *
 * @param {Object} values
 */
C.handler_formChange = function (values) {
  M.setValues(values);
};

/**
 * « Enregistrer ».
 *
 * @param {Object} values
 * @returns {Promise<void>}
 */
C.handler_submit = async function (values) {
  if (!M.startSubmit(values)) return;
  V.render(M.getViewData());

  let isSaved = await M.submit();

  V.render(M.getViewData());
  if (isSaved) {
    V.focusTitle();
  } else {
    V.focusFirstError();
  }
};

/**
 * « Annuler » du formulaire : retour à un formulaire vide.
 */
C.handler_cancelForm = function () {
  M.startCreate();
  V.render(M.getViewData());
  V.focusKey("category-name");
};

/**
 * « Supprimer » sur une ligne : confirmation ou refus expliqué.
 *
 * @param {number} id
 */
C.handler_askDelete = function (id) {
  M.askDelete(id);
  V.render(M.getViewData());
  V.focusDeletion();
};

/**
 * « Annuler » de la confirmation, ou « Fermer » du refus.
 */
C.handler_closeDelete = function () {
  M.closeDelete();
  V.render(M.getViewData());
  V.focusTitle();
};

/**
 * « Confirmer la suppression ».
 *
 * @returns {Promise<void>}
 */
C.handler_confirmDelete = async function () {
  if (!M.startDelete()) return;
  V.render(M.getViewData());

  await M.confirmDelete();

  V.render(M.getViewData());
  if (M.deletion === null) {
    V.focusTitle();
  } else {
    V.focusDeletion();
  }
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
  content: null, // contenu affiché : gestion des catégories, connexion ou erreur
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

  V.notice = page.querySelector("[data-categories-notice]");
  V.notice.replaceChildren(MessageView.dom(data.notice));

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit le contenu et les messages à partir de l'état.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.render = function (data) {
  V.notice.replaceChildren(MessageView.dom(data.notice));
  V.content = replaceKeepingFocus(V.content, V.createContentFragment(data));
};

/**
 * Donne le focus au titre de la page (après un enregistrement ou une
 * suppression : le bouton utilisé a disparu ou changé).
 */
V.focusTitle = function () {
  V.content.querySelector("h1")?.focus();
};

/**
 * Donne le focus au premier champ en erreur, s'il y en a un.
 */
V.focusFirstError = function () {
  V.content.querySelector('[aria-invalid="true"]')?.focus();
};

/**
 * Donne le focus à la confirmation ou au refus de suppression : sur mobile,
 * ils sont sous la liste.
 */
V.focusDeletion = function () {
  V.content.querySelector("#category-delete-title")?.focus();
};

/**
 * @param {string} key - Valeur de data-focus-key de l'élément à focaliser.
 */
V.focusKey = function (key) {
  V.content.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} Le contenu de l'état courant.
 */
V.createContentFragment = function (data) {
  if (data.state === "login") {
    return htmlToFragment(templateLogin);
  }

  if (data.content === null) {
    let fragment = htmlToFragment(genericRenderer(templateError, { message: data.errorMessage }));
    fragment.querySelector('[data-action="retry"]').addEventListener("click", C.handler_retry);
    return fragment;
  }

  let content = data.content;
  let fragment = htmlToFragment(genericRenderer(templateContent, { adminLabel: content.adminLabel }));

  fragment.querySelector('[data-action="new"]').addEventListener("click", C.handler_new);
  fragment.querySelector('slot[name="list"]').replaceWith(V.createListFragment(content.rows, content.caption));
  fragment.querySelector('slot[name="form"]').replaceWith(
    CategoryFormView.dom(content.form, {
      onSubmit: C.handler_submit,
      onChange: C.handler_formChange,
      onCancel: C.handler_cancelForm,
    }),
  );
  fragment.querySelector('slot[name="deletion"]').replaceWith(V.createDeletionFragment(content.deletion));

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getRows>} rows
 * @param {string} caption
 * @returns {DocumentFragment} Le tableau des catégories, ou le message « aucune catégorie ».
 */
V.createListFragment = function (rows, caption) {
  if (rows.length === 0) {
    return htmlToFragment(templateEmpty);
  }

  let fragment = htmlToFragment(genericRenderer(templateTable, { caption }));
  fragment.querySelector("[data-category-rows]").append(...rows.map(V.createRowFragment));

  // Délégation : un seul écouteur pour les boutons de toutes les lignes.
  fragment.querySelector("table").addEventListener("click", (ev) => {
    let button = ev.target.closest("button[data-action]");
    if (button === null) return;
    if (button.dataset.action === "edit") {
      C.handler_edit(Number(button.dataset.id));
    } else {
      C.handler_askDelete(Number(button.dataset.id));
    }
  });

  return fragment;
};

/**
 * @param {ReturnType<typeof M.toRow>} row
 * @returns {DocumentFragment} Une ligne du tableau.
 */
V.createRowFragment = function (row) {
  let fragment = htmlToFragment(genericRenderer(templateRow, row));

  if (row.parentName === "") fragment.querySelector("[data-parent-label]").remove();
  if (row.isEditing) fragment.querySelector("tr").setAttribute("aria-current", "true");

  return fragment;
};

/**
 * @param {NonNullable<ReturnType<typeof M.getViewData>["content"]>["deletion"]} deletion
 * @returns {DocumentFragment} La confirmation, le refus, ou un fragment vide.
 */
V.createDeletionFragment = function (deletion) {
  if (deletion === null) {
    return htmlToFragment("");
  }

  let fragment =
    deletion.blockedMessage === null
      ? htmlToFragment(genericRenderer(templateDeleteConfirm, deletion))
      : htmlToFragment(genericRenderer(templateDeleteBlocked, { message: deletion.blockedMessage }));

  let confirm = fragment.querySelector('[data-action="confirm-delete"]');
  if (confirm !== null) confirm.disabled = deletion.isDeleting;

  // Délégation : un seul écouteur pour les boutons du bloc.
  fragment.firstElementChild.addEventListener("click", (ev) => {
    let button = ev.target.closest("button[data-action]");
    if (button === null || button.disabled) return;
    if (button.dataset.action === "confirm-delete") {
      C.handler_confirmDelete();
    } else {
      C.handler_closeDelete();
    }
  });

  return fragment;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function AdminCategoriesPage() {
  return C.init();
}
