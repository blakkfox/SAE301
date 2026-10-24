import { AdminData } from "../../data/admin.js";
import { formatPrice } from "../../lib/format.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { MessageView } from "../../ui/message/index.js";
import { PromoCodeFormView } from "../../ui/promo-code-form/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateTable from "./table.html?raw";
import templateRow from "./row.html?raw";
import templateEmpty from "./empty.html?raw";
import templateDeleteConfirm from "./delete-confirm.html?raw";
import templateLogin from "./login.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Gestion des codes promo » — US PRO-b (écran Figma n° 22), route
 * /admin/codes-promo.
 *
 * Tous les codes, du plus récent au plus ancien, avec leur remise, leur
 * validité, leurs utilisations et leur statut. Le formulaire de droite crée
 * un code (« Nouveau code ») ou modifie celui choisi (« Modifier ») : code,
 * réduction, montant minimum du panier, dates de début et de fin,
 * utilisations maximales. « Supprimer » demande confirmation.
 *
 * Le serveur décide de tout : accès (401, 403), validation et code unique
 * (422, 409), statut du jour (actif, programmé, expiré, épuisé). La page ne
 * fait que mettre ses réponses en forme.
 *
 * Découpage MVC strict :
 *   M — codes, formulaire, suppression, état de la page, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Valeurs d'un formulaire vide (« Nouveau code promo »), telles que saisies.
const EMPTY_VALUES = { code: "", discountRate: "", minAmount: "", startsOn: "", endsOn: "", maxUses: "" };

// Pastille de statut (.status-badge), classes écrites en entier : même
// couleur que la maquette pour Actif (vert), Programmé (orange), Expiré (gris).
const STATUSES = {
  actif: { label: "Actif", badgeClass: "status-badge--success" },
  programme: { label: "Programmé", badgeClass: "" },
  expire: { label: "Expiré", badgeClass: "status-badge--neutral" },
  epuise: { label: "Épuisé", badgeClass: "status-badge--error" },
};

const SERVER_DOWN = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  response: null, // réponse de GET /api/admin/promo-codes, ou null
  state: "list", // "list", "login" ou "error"
  errorMessage: "", // message de l'état "error"
  notice: null, // { type, texte } au-dessus du contenu, ou null
  editId: null, // code en cours de modification, ou null (création)
  values: null, // saisie du formulaire, voir EMPTY_VALUES
  errors: {}, // erreurs du formulaire, par champ
  isSubmitting: false, // un enregistrement est en cours
  deletion: null, // { id, code, useCount } : suppression demandée, ou null
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
 * Charge les codes promo. Si le code modifié a disparu, le formulaire
 * repasse en création.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  try {
    M.response = await AdminData.fetchPromoCodes();
    M.state = "list";
    if (M.editId !== null && M.findPromoCode(M.editId) === null) M.startCreate();
  } catch (error) {
    if (M.handleAccessError(error)) return;

    let message = error.statut === undefined ? SERVER_DOWN : `Impossible de charger les codes promo : ${error.message}`;
    if (M.response === null) {
      M.state = "error";
      M.errorMessage = message;
    } else {
      M.notice = { type: "erreur", texte: message };
    }
  }
};

/**
 * @param {number} id
 * @returns {?Object} Le code promo, ou null.
 */
M.findPromoCode = function (id) {
  return M.response.promoCodes.find((promoCode) => promoCode.id === id) ?? null;
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
 * Formulaire rempli avec le code choisi, dans le format de saisie
 * (« 50,00 », vide pour « sans minimum » et « illimité »).
 *
 * @param {number} id
 */
M.startEdit = function (id) {
  let promoCode = M.findPromoCode(id);
  if (promoCode === null) return;

  M.editId = id;
  M.values = {
    code: promoCode.code,
    discountRate: String(promoCode.discountRate),
    minAmount: promoCode.minAmount > 0 ? promoCode.minAmount.toFixed(2).replace(".", ",") : "",
    startsOn: promoCode.startsOn ?? "",
    endsOn: promoCode.endsOn ?? "",
    maxUses: promoCode.maxUses === null ? "" : String(promoCode.maxUses),
  };
  M.errors = {};
  M.deletion = null;
};

/**
 * Garde la saisie en cours, pour qu'une reconstruction de la page ne l'efface pas.
 *
 * @param {Object} values - Voir EMPTY_VALUES.
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
 * @returns {Promise<boolean>} true si le code est enregistré.
 */
M.submit = async function () {
  let isCreation = M.editId === null;
  let isSaved = false;

  try {
    let response = isCreation
      ? await AdminData.createPromoCode(M.values)
      : await AdminData.updatePromoCode(M.editId, M.values);

    M.notice = {
      type: "succes",
      texte: `Code ${response.promoCode.code} ${isCreation ? "créé" : "enregistré"}.`,
    };
    M.startCreate();
    isSaved = true;
  } catch (error) {
    if (!M.handleAccessError(error)) {
      if (error.statut === 422 || error.statut === 409) {
        M.errors = error.champs;
      } else if (error.statut === 404) {
        M.notice = { type: "erreur", texte: "Ce code promo n’existe plus." };
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
 * Demande de suppression : la confirmation s'affiche sous le formulaire.
 *
 * @param {number} id
 */
M.askDelete = function (id) {
  let promoCode = M.findPromoCode(id);
  if (promoCode === null) return;

  M.deletion = { id, code: promoCode.code, useCount: promoCode.useCount };
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
  if (M.isDeleting || M.deletion === null) return false;

  M.isDeleting = true;
  return true;
};

/**
 * Supprime le code confirmé, puis recharge la liste.
 *
 * @returns {Promise<void>}
 */
M.confirmDelete = async function () {
  let { id, code } = M.deletion;

  try {
    await AdminData.deletePromoCode(id);
    M.notice = { type: "succes", texte: `Code ${code} supprimé.` };
    if (M.editId === id) M.startCreate();
  } catch (error) {
    if (!M.handleAccessError(error)) {
      M.notice = {
        type: "erreur",
        texte:
          error.statut === 404
            ? "Ce code promo n’existe plus."
            : error.statut === undefined
              ? SERVER_DOWN
              : `Suppression impossible : ${error.message}`,
      };
    }
  }

  M.deletion = null;
  if (M.state === "list") await M.load();
  M.isDeleting = false;
};

/**
 * @param {string} date - « 2026-12-31 ».
 * @param {boolean} [withYear=true]
 * @returns {string} « 31/12/2026 », ou « 31/12 » sans l'année.
 */
M.formatDate = function (date, withYear = true) {
  let [year, month, day] = date.split("-");
  return withYear ? `${day}/${month}/${year}` : `${day}/${month}`;
};

/**
 * Colonne Validité, comme la maquette : « jusqu'au 31/12/2026 »,
 * « du 01/11 au 30/11/2026 » pour un code programmé, « expiré le 31/08/2026 ».
 *
 * @param {Object} promoCode
 * @returns {string}
 */
M.formatValidity = function (promoCode) {
  let { startsOn, endsOn, status } = promoCode;

  if (status === "expire") return `expiré le ${M.formatDate(endsOn)}`;

  if (status === "programme") {
    if (endsOn === null) return `à partir du ${M.formatDate(startsOn)}`;
    let isSameYear = startsOn.slice(0, 4) === endsOn.slice(0, 4);
    return `du ${M.formatDate(startsOn, !isSameYear)} au ${M.formatDate(endsOn)}`;
  }

  return endsOn === null ? "sans date de fin" : `jusqu’au ${M.formatDate(endsOn)}`;
};

/**
 * @param {number} count
 * @returns {string} « Déjà utilisé 34 fois. », ou « Encore jamais utilisé. »
 */
M.formatUseCount = function (count) {
  return count === 0 ? "Encore jamais utilisé." : `Déjà utilisé ${count} fois.`;
};

/**
 * @param {Object} promoCode
 * @returns {Object} Une ligne du tableau, prête à afficher.
 */
M.toRow = function (promoCode) {
  let status = STATUSES[promoCode.status];

  return {
    id: promoCode.id,
    code: promoCode.code,
    // Signe moins typographique et espace insécable, comme la maquette.
    discount: `−${promoCode.discountRate} %`,
    minAmount: promoCode.minAmount > 0 ? `dès ${formatPrice(promoCode.minAmount)}` : "",
    validity: M.formatValidity(promoCode),
    usage: `${promoCode.useCount} / ${promoCode.maxUses ?? "illimité"}`,
    statusLabel: status.label,
    statusClass: status.badgeClass,
    isEditing: promoCode.id === M.editId,
  };
};

/**
 * @returns {Object} Données du formulaire (PromoCodeFormView).
 */
M.getFormData = function () {
  let edited = M.editId === null ? null : M.findPromoCode(M.editId);
  let isEditing = edited !== null;

  let submitLabel = isEditing ? "Enregistrer" : "Créer le code";
  if (M.isSubmitting) submitLabel = "Enregistrement…";

  return {
    title: isEditing ? `Modifier le code ${edited.code}` : "Nouveau code promo",
    submitLabel,
    maxUsesHint: isEditing ? `Vide : illimité. ${M.formatUseCount(edited.useCount)}` : "Vide : illimité.",
    isEditing,
    values: M.values,
    errors: M.errors,
    isSubmitting: M.isSubmitting,
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "list"|"login"|"error", notice: ?{type: string, texte: string}, errorMessage: string,
 *   content: ?{adminLabel: string, rows: Array<ReturnType<typeof M.toRow>>, caption: string,
 *     form: ReturnType<typeof M.getFormData>,
 *     deletion: ?{code: string, usageNote: string, confirmLabel: string, isDeleting: boolean}}}}
 */
M.getViewData = function () {
  if (M.state !== "list" || M.response === null) {
    return { state: M.state, notice: M.notice, errorMessage: M.errorMessage, content: null };
  }

  let rows = M.response.promoCodes.map(M.toRow);

  return {
    state: M.state,
    notice: M.notice,
    errorMessage: M.errorMessage,
    content: {
      adminLabel: `${M.response.admin.firstName} (admin) · Lyon Centre`,
      rows,
      caption: `${rows.length} ${rows.length > 1 ? "codes promo" : "code promo"}`,
      form: M.getFormData(),
      deletion:
        M.deletion === null
          ? null
          : {
              code: M.deletion.code,
              usageNote: M.formatUseCount(M.deletion.useCount),
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
 * « + Nouveau code » : formulaire vide, focus sur le code.
 */
C.handler_new = function () {
  M.startCreate();
  V.render(M.getViewData());
  V.focusKey("promo-code");
};

/**
 * « Modifier » sur une ligne : formulaire rempli, focus sur le code.
 *
 * @param {number} id
 */
C.handler_edit = function (id) {
  M.startEdit(id);
  V.render(M.getViewData());
  V.focusKey("promo-code");
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
 * « Créer le code » ou « Enregistrer ».
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
  V.focusKey("promo-code");
};

/**
 * « Supprimer » sur une ligne : confirmation.
 *
 * @param {number} id
 */
C.handler_askDelete = function (id) {
  M.askDelete(id);
  V.render(M.getViewData());
  V.focusDeletion();
};

/**
 * « Annuler » de la confirmation.
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
  content: null, // contenu affiché : gestion des codes, connexion ou erreur
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

  V.notice = page.querySelector("[data-promo-notice]");
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
 * Donne le focus à la confirmation de suppression : sur mobile, elle est
 * sous la liste.
 */
V.focusDeletion = function () {
  V.content.querySelector("#promo-delete-title")?.focus();
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
    PromoCodeFormView.dom(content.form, {
      onSubmit: C.handler_submit,
      onChange: C.handler_formChange,
      onCancel: C.handler_cancelForm,
    }),
  );
  fragment.querySelector('slot[name="deletion"]').replaceWith(V.createDeletionFragment(content.deletion));

  return fragment;
};

/**
 * @param {Array<ReturnType<typeof M.toRow>>} rows
 * @param {string} caption
 * @returns {DocumentFragment} Le tableau des codes, ou le message « aucun code ».
 */
V.createListFragment = function (rows, caption) {
  if (rows.length === 0) {
    return htmlToFragment(templateEmpty);
  }

  let fragment = htmlToFragment(genericRenderer(templateTable, { caption }));
  fragment.querySelector("[data-promo-rows]").append(...rows.map(V.createRowFragment));

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

  if (row.minAmount === "") fragment.querySelector("[data-min-amount]").remove();
  if (row.isEditing) fragment.querySelector("tr").setAttribute("aria-current", "true");

  return fragment;
};

/**
 * @param {NonNullable<ReturnType<typeof M.getViewData>["content"]>["deletion"]} deletion
 * @returns {DocumentFragment} La confirmation, ou un fragment vide.
 */
V.createDeletionFragment = function (deletion) {
  if (deletion === null) {
    return htmlToFragment("");
  }

  let fragment = htmlToFragment(genericRenderer(templateDeleteConfirm, deletion));
  fragment.querySelector('[data-action="confirm-delete"]').disabled = deletion.isDeleting;

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
export function AdminPromoCodesPage() {
  return C.init();
}
