import { AdminData } from "../../data/admin.js";
import { ProductData } from "../../data/product.js";
import { formatOrderNumber } from "../../lib/order.js";
import { getStockStatus, LOW_STOCK_MAX } from "../../lib/stock.js";
import { applyFieldErrors, genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { MessageView } from "../../ui/message/index.js";
import { StockBadgeView } from "../../ui/stock-badge/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateCategoryOption from "./category-option.html?raw";
import templateImageField from "./image-field.html?raw";
import templateImageOption from "./image-option.html?raw";
import templatePhoto from "./photo.html?raw";
import templatePhotoPlaceholder from "./photo-placeholder.html?raw";
import templatePublication from "./publication.html?raw";
import templateOptionsTable from "./options-table.html?raw";
import templateOptionsEmpty from "./options-empty.html?raw";
import templateOptionRow from "./option-row.html?raw";
import templateVariantsTable from "./variants-table.html?raw";
import templateVariantsEmpty from "./variants-empty.html?raw";
import templateVariantRow from "./variant-row.html?raw";
import templateMovements from "./movements.html?raw";
import templateMovementsList from "./movements-list.html?raw";
import templateMovementRow from "./movement-row.html?raw";
import templateMovementsEmpty from "./movements-empty.html?raw";
import templateDeleteButton from "./delete-button.html?raw";
import templateDeleteConfirm from "./delete-confirm.html?raw";
import templateDeleteBlocked from "./delete-blocked.html?raw";
import templateDeleted from "./deleted.html?raw";
import templateNotFound from "./not-found.html?raw";
import templateLogin from "./login.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Modifier un produit » — US GOF-a (écran Figma n° 19), routes
 * /admin/produits/:id et /admin/produits/nouveau.
 *
 * Un seul formulaire : informations (nom, prix, catégorie, description,
 * seuil « Bientôt épuisé », options proposées), variantes et stock, photo,
 * publication. « Enregistrer » envoie le tout ; « Supprimer le produit »
 * demande confirmation. Les derniers mouvements de stock (journal de STK-a)
 * sont rappelés sous les variantes.
 *
 * Le serveur décide de tout : accès (401, 403), validation (422), référence
 * unique (409), suppression refusée si une commande en cours contient le
 * produit (409). Le stock saisi est envoyé avec celui affiché au chargement :
 * le serveur n'applique que l'écart, sans effacer une vente faite entre-temps.
 *
 * Découpage MVC strict :
 *   M — fiche, saisie, suppression, état de la page, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Segment d'adresse d'un nouveau produit : /admin/produits/nouveau.
const NEW_ID = "nouveau";

// Statut de publication, classes écrites en entier (voir .status-badge).
const PUBLICATION = {
  online: { label: "En ligne", modifier: "status-badge--success" },
  offline: { label: "Hors ligne", modifier: "status-badge--neutral" },
};

// Motifs du journal des stocks (colonne stock_movement.reason).
const MOVEMENT_REASONS = {
  commande: "Commande",
  annulation: "Annulation",
  reassort: "Réassort",
  ajustement: "Ajustement",
};

// Couleur de la quantité d'un mouvement, classes écrites en entier. Le vert
// Statut/Succès n'est pas assez contrasté pour du texte : une hausse reste
// en gris anthracite.
const QUANTITY_CLASSES = {
  down: "text-accent",
  up: "text-ink",
};

const SERVER_DOWN = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";

// Emplacements de photos : ceux de la galerie de la fiche (IMAGES_MAX côté serveur).
const IMAGE_SLOTS = 4;

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  productId: null, // produit affiché (identifiant de l'adresse), ou null pour un nouveau produit
  response: null, // réponse de GET /api/admin/product, ou null
  state: "form", // "form", "login", "notFound", "error" ou "deleted"
  message: "", // message des états "login" et "error"
  notice: null, // { type, texte } au-dessus du contenu, ou null
  values: null, // saisie du formulaire (voir M.toValues)
  isDirty: false, // la saisie a changé depuis le chargement ou le dernier enregistrement
  errors: {}, // erreurs du formulaire, par champ (« variants.0.reference »…)
  isSubmitting: false, // un enregistrement est en cours
  deletion: null, // { blockedMessage } : suppression demandée, ou null
  isDeleting: false, // une suppression est en cours
  deletedName: "", // nom du produit supprimé (état "deleted")
};

/**
 * Remet la page dans son état initial.
 *
 * @param {string} id - Paramètre de l'adresse : un identifiant, ou « nouveau ».
 */
M.reset = function (id) {
  M.productId = id === NEW_ID ? null : id;
  M.response = null;
  M.state = "form";
  M.message = "";
  M.notice = null;
  M.values = null;
  M.isDirty = false;
  M.errors = {};
  M.isSubmitting = false;
  M.deletion = null;
  M.isDeleting = false;
  M.deletedName = "";
};

/**
 * @returns {boolean} true tant que le produit n'est pas encore créé.
 */
M.isNew = function () {
  return M.productId === null;
};

/**
 * @returns {string} Chemin de route du produit affiché, « /admin/produits/13 ».
 */
M.getPath = function () {
  return `/admin/produits/${M.productId}`;
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
  M.message =
    error.statut === 403
      ? "Vous êtes connecté avec un compte client. Connectez-vous avec un compte administrateur pour gérer les produits."
      : "Connectez-vous avec un compte administrateur pour gérer les produits.";
  return true;
};

/**
 * Charge la fiche (ou seulement les catégories et photos d'un nouveau
 * produit), et remplit le formulaire.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  try {
    M.response = await AdminData.fetchProduct(M.productId);
    M.state = "form";
    M.productId = M.response.product?.id ?? null;
    M.values = M.toValues(M.response.product);
    M.isDirty = false;
  } catch (error) {
    if (M.handleAccessError(error)) return;

    if (error.statut === 400 || error.statut === 404) {
      M.state = "notFound";
      return;
    }

    M.state = "error";
    M.message = error.statut === undefined ? SERVER_DOWN : `Impossible de charger le produit : ${error.message}`;
  }
};

/**
 * @param {number} amount - Montant en euros, 379.9.
 * @returns {string} Le montant à saisir, « 379,90 ».
 */
M.formatAmount = function (amount) {
  return amount.toFixed(2).replace(".", ",");
};

/**
 * Saisie du formulaire, à partir de la fiche reçue. Les nombres restent
 * des textes, tels que saisis : le serveur les valide. Chaque variante
 * existante garde previousStock, le stock affiché au chargement.
 *
 * @param {?Object} product - Fiche de GET /api/admin/product, ou null (nouveau produit).
 * @returns {{name: string, categoryId: ?number, description: string, lowStockThreshold: string,
 *   variantAxis: string, images: string[], isActive: boolean,
 *   variants: Array<{id: ?number, label: string, reference: string, price: string, stock: string,
 *     previousStock: ?number}>,
 *   options: Array<{id: ?number, label: string, description: string, price: string}>}}
 */
M.toValues = function (product) {
  if (product === null) {
    return {
      name: "",
      categoryId: null,
      description: "",
      lowStockThreshold: String(LOW_STOCK_MAX),
      variantAxis: "",
      images: M.toImageSlots([]),
      isActive: true,
      // Tout produit a au moins une variante : « Unique » s'il n'a pas de déclinaison.
      variants: [{ id: null, label: "Unique", reference: "", price: "", stock: "0", previousStock: null }],
      options: [],
    };
  }

  return {
    name: product.name,
    categoryId: product.categoryId,
    description: product.description ?? "",
    lowStockThreshold: String(product.lowStockThreshold),
    variantAxis: product.variantAxis ?? "",
    images: M.toImageSlots(product.images),
    isActive: product.isActive,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      reference: variant.reference,
      price: M.formatAmount(variant.price),
      stock: String(variant.stock),
      previousStock: variant.stock,
    })),
    options: product.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description ?? "",
      price: M.formatAmount(option.price),
    })),
  };
};

/**
 * @param {string[]} images - Photos enregistrées, dans l'ordre.
 * @returns {string[]} Les IMAGE_SLOTS emplacements du formulaire, « » pour un vide.
 */
M.toImageSlots = function (images) {
  return Array.from({ length: IMAGE_SLOTS }, (unused, index) => images[index] ?? "");
};

/**
 * Garde la saisie en cours, pour qu'une reconstruction de la page ne
 * l'efface pas. Les lignes sont affichées dans l'ordre de M.values : leur
 * id et previousStock, que le formulaire ne montre pas, sont repris par
 * position. La fiche est désormais modifiée : la quitter demandera
 * confirmation (voir lib/router.js).
 *
 * @param {Object} formValues - Saisie lue dans le formulaire (V.readValues).
 */
M.setValues = function (formValues) {
  M.values = {
    ...formValues,
    variants: formValues.variants.map((variant, index) => ({ ...M.values.variants[index], ...variant })),
    options: formValues.options.map((option, index) => ({ ...M.values.options[index], ...option })),
  };
  M.isDirty = true;
};

/**
 * « + Ajouter une variante » : une ligne vide, à enregistrer. Elle reprend le
 * prix de la dernière variante, le plus souvent le même.
 */
M.addVariant = function () {
  let price = M.values.variants.at(-1)?.price ?? "";
  M.values.variants = [...M.values.variants, { id: null, label: "", reference: "", price, stock: "0", previousStock: null }];
  M.errors = {};
  M.isDirty = true;
};

/**
 * « Retirer » une variante : elle sera supprimée à l'enregistrement.
 *
 * @param {number} index - Position de la ligne.
 */
M.removeVariant = function (index) {
  M.values.variants = M.values.variants.filter((variant, position) => position !== index);
  M.errors = {};
  M.isDirty = true;
};

/**
 * « + Ajouter une option » : une ligne vide, à enregistrer.
 */
M.addOption = function () {
  M.values.options = [...M.values.options, { id: null, label: "", description: "", price: "" }];
  M.errors = {};
  M.isDirty = true;
};

/**
 * « Retirer » une option : elle sera supprimée à l'enregistrement.
 *
 * @param {number} index - Position de la ligne.
 */
M.removeOption = function (index) {
  M.values.options = M.values.options.filter((option, position) => position !== index);
  M.errors = {};
  M.isDirty = true;
};

/**
 * @returns {number} Position de la dernière variante, pour y placer le focus.
 */
M.getLastVariantIndex = function () {
  return M.values.variants.length - 1;
};

/**
 * @returns {number} Position de la dernière option, pour y placer le focus.
 */
M.getLastOptionIndex = function () {
  return M.values.options.length - 1;
};

/**
 * @returns {Object} Corps de la requête d'enregistrement : la saisie, avec
 *   l'id des lignes existantes et le previousStock des variantes.
 */
M.toPayload = function () {
  let values = M.values;

  return {
    name: values.name,
    categoryId: values.categoryId,
    description: values.description,
    lowStockThreshold: values.lowStockThreshold,
    variantAxis: values.variantAxis,
    // Emplacements vides retirés : la première photo choisie devient la principale.
    images: values.images.filter((image) => image !== ""),
    isActive: values.isActive,
    variants: values.variants.map((variant) =>
      variant.id === null
        ? { id: null, label: variant.label, reference: variant.reference, price: variant.price, stock: variant.stock }
        : {
            id: variant.id,
            label: variant.label,
            reference: variant.reference,
            price: variant.price,
            stock: variant.stock,
            previousStock: variant.previousStock,
          },
    ),
    options: values.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      price: option.price,
    })),
  };
};

/**
 * Début d'un enregistrement.
 *
 * @param {Object} formValues - Saisie envoyée.
 * @returns {boolean} false si un enregistrement est déjà en cours.
 */
M.startSubmit = function (formValues) {
  if (M.isSubmitting) return false;

  M.setValues(formValues);
  M.isSubmitting = true;
  M.notice = null;
  M.deletion = null;
  return true;
};

/**
 * Enregistre la saisie (création ou modification). Réussi, le formulaire
 * est rempli avec la fiche renvoyée par le serveur (stocks à jour) ; refusé,
 * les erreurs s'affichent sous leur champ.
 *
 * @returns {Promise<boolean>} true si le produit est enregistré.
 */
M.submit = async function () {
  let isCreation = M.isNew();
  let isSaved = false;

  try {
    let response = isCreation
      ? await AdminData.createProduct(M.toPayload())
      : await AdminData.updateProduct(M.productId, M.toPayload());

    M.response.product = response.product;
    M.productId = response.product.id;
    M.values = M.toValues(response.product);
    M.isDirty = false;
    M.errors = {};
    M.notice = {
      type: "succes",
      texte: `Produit « ${response.product.name} » ${isCreation ? "créé" : "enregistré"}.`,
    };
    isSaved = true;
  } catch (error) {
    if (!M.handleAccessError(error)) {
      if (error.statut === 422 || error.statut === 409) {
        M.errors = error.champs;
        M.notice = { type: "erreur", texte: error.message };
      } else if (error.statut === 404) {
        M.state = "notFound";
      } else {
        M.notice = {
          type: "erreur",
          texte: error.statut === undefined ? SERVER_DOWN : `Enregistrement impossible : ${error.message}`,
        };
      }
    }
  }

  M.isSubmitting = false;
  return isSaved;
};

/**
 * « Supprimer le produit » : affiche la confirmation.
 */
M.askDelete = function () {
  M.deletion = { blockedMessage: null };
  M.notice = null;
};

/**
 * Referme la confirmation, ou le refus.
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
  if (M.isDeleting || M.isNew() || M.deletion === null || M.deletion.blockedMessage !== null) return false;

  M.isDeleting = true;
  return true;
};

/**
 * Supprime le produit. Un refus du serveur (409 : commande en cours)
 * remplace la confirmation.
 *
 * @returns {Promise<void>}
 */
M.confirmDelete = async function () {
  try {
    let response = await AdminData.deleteProduct(M.productId);
    M.deletedName = response.deleted.name;
    M.state = "deleted";
    M.deletion = null;
  } catch (error) {
    if (!M.handleAccessError(error)) {
      if (error.statut === 409) {
        M.deletion = { blockedMessage: error.message };
      } else if (error.statut === 404) {
        M.state = "notFound";
      } else {
        M.deletion = null;
        M.notice = {
          type: "erreur",
          texte: error.statut === undefined ? SERVER_DOWN : `Suppression impossible : ${error.message}`,
        };
      }
    }
  }

  M.isDeleting = false;
};

/**
 * @param {string} text - Nombre saisi.
 * @returns {number} L'entier saisi, ou 0 si la saisie n'en est pas un.
 */
M.parseCount = function (text) {
  let count = Number.parseInt(text, 10);
  return Number.isNaN(count) ? 0 : count;
};

/**
 * Ce qui change pendant la saisie, sans reconstruire le formulaire : en-tête
 * de la colonne des variantes, état de chaque variante, aperçu de la photo,
 * statut de publication, avertissement de catégorie masquée.
 *
 * @returns {{axisLabel: string, variantStatuses: Array<"in"|"low"|"out">,
 *   photo: {url: ?string, name: string}, publication: {label: string, modifier: string},
 *   categoryHint: string}}
 */
M.getLiveData = function () {
  let values = M.values;
  let threshold = values.lowStockThreshold.trim() === "" ? LOW_STOCK_MAX : M.parseCount(values.lowStockThreshold);
  let category = M.response.categories.find((item) => item.id === values.categoryId) ?? null;

  return {
    axisLabel: values.variantAxis.trim() === "" ? "Variante" : values.variantAxis.trim(),
    variantStatuses: values.variants.map((variant) => getStockStatus(M.parseCount(variant.stock), threshold)),
    photo: {
      url: ProductData.imageUrl(values.images.find((image) => image !== "") ?? null),
      name: values.name.trim() === "" ? "Photo du produit" : values.name.trim(),
    },
    publication: values.isActive ? PUBLICATION.online : PUBLICATION.offline,
    categoryHint:
      category !== null && !category.isVisible
        ? "Catégorie masquée : le produit n’apparaît pas dans la boutique tant qu’elle l’est."
        : "",
  };
};

/**
 * @param {{createdAt: string, reason: string, quantity: number, orderId: ?number, label: string}} movement
 * @returns {{date: string, label: string, quantity: string, quantityLabel: string, quantityClass: string}}
 *   Une ligne de « Mouvements de stock » : « 13/10 14:02 · Commande CMD-0142 · taille M · −1 ».
 */
M.toMovement = function (movement) {
  let date = movement.createdAt;
  let axis = M.response.product.variantAxis;
  let variant = axis === null ? movement.label : `${axis.toLowerCase()} ${movement.label}`;
  let reason = MOVEMENT_REASONS[movement.reason];
  if (movement.orderId !== null) reason += ` ${formatOrderNumber(movement.orderId)}`;

  let count = Math.abs(movement.quantity);
  let units = count > 1 ? "unités" : "unité";
  let isDown = movement.quantity < 0;

  return {
    date: `${date.slice(8, 10)}/${date.slice(5, 7)} ${date.slice(11, 16)}`,
    label: `${reason} · ${variant}`,
    // Vrai signe moins (U+2212), plus lisible qu'un tiret.
    quantity: isDown ? `−${count}` : `+${count}`,
    quantityLabel: isDown ? `${count} ${units} en moins` : `${count} ${units} en plus`,
    quantityClass: isDown ? QUANTITY_CLASSES.down : QUANTITY_CLASSES.up,
  };
};

/**
 * @returns {Object} Données du formulaire, prêtes à afficher.
 */
M.getFormData = function () {
  let values = M.values;
  let product = M.response.product;

  // Une photo enregistrée mais absente du dossier reste proposée : le
  // serveur la refusera à l'enregistrement, ce qui signale le problème.
  let missing = values.images.filter((image) => image !== "" && !M.response.images.includes(image));
  let images = [...missing, ...M.response.images].map((file) => ({ file }));

  return {
    title: M.isNew() ? "Nouveau produit" : "Modifier un produit",
    adminLabel: `${M.response.admin.firstName} (admin) · Lyon Centre`,
    breadcrumb: M.isNew() ? "Nouveau produit" : product.name,
    name: values.name,
    description: values.description,
    lowStockThreshold: values.lowStockThreshold,
    variantAxis: values.variantAxis,
    categoryId: values.categoryId,
    imageFields: values.images.map((image, index) => ({
      index,
      label: index === 0 ? "Photo 1 (principale)" : `Photo ${index + 1}`,
      value: image,
    })),
    isActive: values.isActive,
    categories: M.response.categories.map((category) => ({
      id: category.id,
      label:
        (category.parentName === null ? category.name : `${category.parentName} › ${category.name}`) +
        (category.isVisible ? "" : " (masquée)"),
    })),
    images,
    variants: values.variants.map((variant, index) => ({
      index,
      number: index + 1,
      label: variant.label,
      reference: variant.reference,
      price: variant.price,
      stock: variant.stock,
    })),
    variantsCaption: `${values.variants.length} ${values.variants.length > 1 ? "variantes" : "variante"}`,
    options: values.options.map((option, index) => ({
      index,
      number: index + 1,
      label: option.label,
      description: option.description,
      price: option.price,
    })),
    optionsCaption: `${values.options.length} ${values.options.length > 1 ? "options" : "option"}`,
    // Le journal n'existe que pour un produit enregistré.
    movements: M.isNew() ? null : product.movements.map(M.toMovement),
    live: M.getLiveData(),
    errors: M.errors,
    isDirty: M.isDirty,
    isSubmitting: M.isSubmitting,
    submitLabel: M.isSubmitting ? "Enregistrement…" : M.isNew() ? "Créer le produit" : "Enregistrer",
    canDelete: !M.isNew(),
    deletion:
      M.deletion === null
        ? null
        : {
            name: product.name,
            blockedMessage: M.deletion.blockedMessage,
            confirmLabel: M.isDeleting ? "Suppression…" : "Confirmer la suppression",
            isDeleting: M.isDeleting,
          },
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "form"|"login"|"notFound"|"error"|"deleted", notice: ?{type: string, texte: string},
 *   message: string, title: string, deletedName: string, form: ?ReturnType<typeof M.getFormData>}}
 */
M.getViewData = function () {
  return {
    state: M.state,
    notice: M.notice,
    message: M.message,
    title: M.isNew() ? "Nouveau produit" : "Modifier un produit",
    deletedName: M.deletedName,
    form: M.state === "form" && M.response !== null ? M.getFormData() : null,
  };
};

// ---------------------------------------------------------------------------
// C — Contrôleur
// ---------------------------------------------------------------------------

let C = {};

/**
 * Point d'entrée de la page, appelé par le routeur.
 *
 * @param {{id: string}} params - Identifiant du produit, ou « nouveau ».
 * @returns {Promise<DocumentFragment>}
 */
C.init = async function (params) {
  M.reset(params.id);
  await M.load();
  return V.init(M.getViewData());
};

/**
 * Saisie dans le formulaire : gardée, et seuls les blocs qui en dépendent
 * (états, aperçu, statut) sont reconstruits.
 *
 * @param {Object} values - Saisie lue dans le formulaire.
 */
C.handler_formChange = function (values) {
  M.setValues(values);
  V.renderLive(M.getLiveData());
  V.renderDirty(M.isDirty);
};

/**
 * « + Ajouter une variante » : nouvelle ligne, focus sur son libellé.
 */
C.handler_addVariant = function () {
  M.addVariant();
  V.render(M.getViewData());
  V.focusKey(`variant-${M.getLastVariantIndex()}-label`);
};

/**
 * « Retirer » une variante.
 *
 * @param {number} index - Position de la ligne.
 */
C.handler_removeVariant = function (index) {
  M.removeVariant(index);
  V.render(M.getViewData());
  V.focusKey("add-variant");
};

/**
 * « + Ajouter une option » : nouvelle ligne, focus sur son libellé.
 */
C.handler_addOption = function () {
  M.addOption();
  V.render(M.getViewData());
  V.focusKey(`option-${M.getLastOptionIndex()}-label`);
};

/**
 * « Retirer » une option.
 *
 * @param {number} index - Position de la ligne.
 */
C.handler_removeOption = function (index) {
  M.removeOption(index);
  V.render(M.getViewData());
  V.focusKey("add-option");
};

/**
 * « Enregistrer » (ou « Créer le produit »).
 *
 * @param {Object} values - Saisie lue dans le formulaire.
 * @returns {Promise<void>}
 */
C.handler_submit = async function (values) {
  if (!M.startSubmit(values)) return;
  V.render(M.getViewData());

  let wasNew = M.isNew();
  let isSaved = await M.submit();

  // Produit créé : l'adresse devient celle de sa fiche, sans recharger.
  if (isSaved && wasNew) V.replaceUrl(M.getPath());

  V.render(M.getViewData());
  if (isSaved) {
    V.focusTitle();
  } else {
    V.focusFirstError();
  }
};

/**
 * « Supprimer le produit » : confirmation.
 */
C.handler_askDelete = function () {
  M.askDelete();
  V.render(M.getViewData());
  V.focusDeletion();
};

/**
 * « Annuler » de la confirmation, ou « Fermer » du refus.
 */
C.handler_closeDelete = function () {
  M.closeDelete();
  V.render(M.getViewData());
  V.focusKey("ask-delete");
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
  content: null, // contenu affiché : fiche, connexion, erreur…
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

  V.notice = page.querySelector("[data-product-notice]");
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
 * Reconstruit les blocs qui suivent la saisie, sans toucher aux champs :
 * le focus et le curseur restent où ils sont.
 *
 * @param {ReturnType<typeof M.getLiveData>} live
 */
V.renderLive = function (live) {
  V.applyLive(V.content, live);
};

/**
 * Signale au routeur que la fiche a des modifications non enregistrées.
 *
 * @param {boolean} isDirty
 */
V.renderDirty = function (isDirty) {
  V.content.querySelector("form")?.toggleAttribute("data-unsaved", isDirty);
};

/**
 * Remplace l'adresse affichée, sans changer de page (produit créé).
 *
 * @param {string} path - Chemin de route, par exemple « /admin/produits/19 ».
 */
V.replaceUrl = function (path) {
  window.history.replaceState(null, "", import.meta.env.BASE_URL + path.replace(/^\//, ""));
};

/**
 * Donne le focus au titre de la page (après un enregistrement ou une
 * suppression : le message est juste au-dessus).
 */
V.focusTitle = function () {
  V.content.querySelector("h1")?.focus();
};

/**
 * Donne le focus au premier champ en erreur, ou au titre s'il n'y en a pas.
 */
V.focusFirstError = function () {
  let field = V.content.querySelector('[aria-invalid="true"]');
  if (field !== null) {
    field.focus();
  } else {
    V.focusTitle();
  }
};

/**
 * Donne le focus à la confirmation ou au refus de suppression.
 */
V.focusDeletion = function () {
  V.content.querySelector("#product-delete-title")?.focus();
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
    return htmlToFragment(genericRenderer(templateLogin, { title: data.title, message: data.message }));
  }
  if (data.state === "notFound") {
    return htmlToFragment(templateNotFound);
  }
  if (data.state === "deleted") {
    return htmlToFragment(genericRenderer(templateDeleted, { name: data.deletedName }));
  }
  if (data.form === null) {
    let fragment = htmlToFragment(genericRenderer(templateError, { title: data.title, message: data.message }));
    fragment.querySelector('[data-action="retry"]').addEventListener("click", C.handler_retry);
    return fragment;
  }

  return V.createFormFragment(data.form);
};

/**
 * @param {ReturnType<typeof M.getFormData>} data
 * @returns {DocumentFragment} La fiche : en-tête, formulaire et mouvements.
 */
V.createFormFragment = function (data) {
  let fragment = htmlToFragment(genericRenderer(templateContent, data));
  let form = fragment.querySelector("form");

  form.querySelector('slot[name="categories"]').replaceWith(
    ...data.categories.map((category) => htmlToFragment(genericRenderer(templateCategoryOption, category))),
  );
  form.querySelector('slot[name="image-fields"]').replaceWith(V.createImageFieldsFragment(data.imageFields, data.images));
  form.querySelector('slot[name="options"]').replaceWith(V.createOptionsFragment(data.options, data.optionsCaption));
  form.querySelector('slot[name="variants"]').replaceWith(
    V.createVariantsFragment(data.variants, data.variantsCaption, data.live.axisLabel),
  );
  form.querySelector('slot[name="movements"]').replaceWith(V.createMovementsFragment(data.movements));
  form.querySelector('slot[name="delete"]').replaceWith(V.createDeleteFragment(data.canDelete, data.deletion));

  // Un template n'a pas de condition : valeurs et états se règlent ici.
  form.elements.categoryId.value = data.categoryId === null ? "" : String(data.categoryId);
  form.elements.isActive.checked = data.isActive;
  form.setAttribute("aria-busy", String(data.isSubmitting));
  // Lu par le routeur : confirmation avant de quitter une fiche modifiée.
  form.toggleAttribute("data-unsaved", data.isDirty);
  form.querySelector('[type="submit"]').disabled = data.isSubmitting;
  applyFieldErrors(form, data.errors);
  V.applyLive(fragment, data.live);

  form.addEventListener("input", () => C.handler_formChange(V.readValues(form)));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    C.handler_submit(V.readValues(form));
  });

  // Délégation : un seul écouteur pour tous les boutons du formulaire.
  form.addEventListener("click", (ev) => {
    let button = ev.target.closest("button[data-action]");
    if (button === null || button.disabled) return;

    let index = Number(button.dataset.index);
    let actions = {
      "add-variant": () => C.handler_addVariant(),
      "remove-variant": () => C.handler_removeVariant(index),
      "add-option": () => C.handler_addOption(),
      "remove-option": () => C.handler_removeOption(index),
      "ask-delete": () => C.handler_askDelete(),
      "confirm-delete": () => C.handler_confirmDelete(),
      "close-delete": () => C.handler_closeDelete(),
    };
    actions[button.dataset.action]?.();
  });

  return fragment;
};

/**
 * Lit la saisie du formulaire. Les lignes sont lues dans l'ordre affiché.
 *
 * @param {HTMLFormElement} form
 * @returns {Object} La saisie, comme M.toValues, sans id ni previousStock.
 */
V.readValues = function (form) {
  let elements = form.elements;
  let variantCount = form.querySelectorAll("[data-variant-rows] tr").length;
  let optionCount = form.querySelectorAll("[data-option-rows] tr").length;

  return {
    name: elements.name.value,
    categoryId: elements.categoryId.value === "" ? null : Number(elements.categoryId.value),
    description: elements.description.value,
    lowStockThreshold: elements.lowStockThreshold.value,
    variantAxis: elements.variantAxis.value,
    images: Array.from({ length: IMAGE_SLOTS }, (unused, index) => elements.namedItem(`images.${index}`).value),
    isActive: elements.isActive.checked,
    variants: Array.from({ length: variantCount }, (unused, index) => ({
      label: elements.namedItem(`variants.${index}.label`).value,
      reference: elements.namedItem(`variants.${index}.reference`).value,
      price: elements.namedItem(`variants.${index}.price`).value,
      stock: elements.namedItem(`variants.${index}.stock`).value,
    })),
    options: Array.from({ length: optionCount }, (unused, index) => ({
      label: elements.namedItem(`options.${index}.label`).value,
      description: elements.namedItem(`options.${index}.description`).value,
      price: elements.namedItem(`options.${index}.price`).value,
    })),
  };
};

/**
 * Remplit les blocs qui suivent la saisie (voir M.getLiveData).
 *
 * @param {ParentNode} root - Contenu affiché, ou fragment en construction.
 * @param {ReturnType<typeof M.getLiveData>} live
 */
V.applyLive = function (root, live) {
  let axis = root.querySelector('[data-live="axis"]');
  if (axis !== null) axis.textContent = live.axisLabel;

  for (const cell of root.querySelectorAll('[data-live="variant-status"]')) {
    cell.replaceChildren(StockBadgeView.dom(live.variantStatuses[Number(cell.dataset.index)]));
  }

  root.querySelector('[data-live="photo"]')?.replaceChildren(V.createPhotoFragment(live.photo));
  root
    .querySelector('[data-live="publication"]')
    ?.replaceChildren(htmlToFragment(genericRenderer(templatePublication, live.publication)));

  let hint = root.querySelector('[data-live="category-hint"]');
  if (hint !== null) hint.textContent = live.categoryHint;
};

/**
 * @param {Array<{index: number, label: string, value: string}>} fields - Emplacements de photos.
 * @param {Array<{file: string}>} images - Fichiers proposés.
 * @returns {DocumentFragment} Un sélecteur par emplacement, sur sa photo.
 */
V.createImageFieldsFragment = function (fields, images) {
  let fragment = new DocumentFragment();

  for (const field of fields) {
    let item = htmlToFragment(genericRenderer(templateImageField, field));
    item
      .querySelector('slot[name="options"]')
      .replaceWith(...images.map((image) => htmlToFragment(genericRenderer(templateImageOption, image))));
    // Un template n'a pas de condition : le fichier choisi se règle ici.
    item.querySelector("select").value = field.value;
    fragment.append(item);
  }

  return fragment;
};

/**
 * @param {{url: ?string, name: string}} photo
 * @returns {DocumentFragment} L'aperçu de la photo, ou « Photo à venir ».
 */
V.createPhotoFragment = function (photo) {
  if (photo.url === null) {
    return htmlToFragment(templatePhotoPlaceholder);
  }

  let fragment = htmlToFragment(genericRenderer(templatePhoto, photo));
  // Fichier illisible : l'emplacement « Photo à venir » le remplace.
  let image = fragment.querySelector("img");
  image.addEventListener("error", () => image.replaceWith(htmlToFragment(templatePhotoPlaceholder)));

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getFormData>["options"]} options
 * @param {string} caption
 * @returns {DocumentFragment} Le tableau des options, ou « Aucune option ».
 */
V.createOptionsFragment = function (options, caption) {
  if (options.length === 0) {
    return htmlToFragment(templateOptionsEmpty);
  }

  let fragment = htmlToFragment(genericRenderer(templateOptionsTable, { caption }));
  fragment
    .querySelector("[data-option-rows]")
    .append(...options.map((option) => htmlToFragment(genericRenderer(templateOptionRow, option))));

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getFormData>["variants"]} variants
 * @param {string} caption
 * @param {string} axisLabel - En-tête de la première colonne (« Taille »).
 * @returns {DocumentFragment} Le tableau des variantes, ou « Aucune variante ».
 */
V.createVariantsFragment = function (variants, caption, axisLabel) {
  if (variants.length === 0) {
    return htmlToFragment(templateVariantsEmpty);
  }

  let fragment = htmlToFragment(genericRenderer(templateVariantsTable, { caption, axisLabel }));
  fragment
    .querySelector("[data-variant-rows]")
    .append(...variants.map((variant) => htmlToFragment(genericRenderer(templateVariantRow, variant))));

  return fragment;
};

/**
 * @param {?Array<ReturnType<typeof M.toMovement>>} movements - null pour un nouveau produit.
 * @returns {DocumentFragment} Le bloc « Mouvements de stock », ou un fragment vide.
 */
V.createMovementsFragment = function (movements) {
  if (movements === null) {
    return htmlToFragment("");
  }

  let fragment = htmlToFragment(templateMovements);
  let list = movements.length === 0 ? htmlToFragment(templateMovementsEmpty) : htmlToFragment(templateMovementsList);
  list
    .querySelector("ul")
    ?.append(...movements.map((movement) => htmlToFragment(genericRenderer(templateMovementRow, movement))));
  fragment.querySelector('slot[name="list"]').replaceWith(list);

  return fragment;
};

/**
 * @param {boolean} canDelete - false pour un produit pas encore créé.
 * @param {ReturnType<typeof M.getFormData>["deletion"]} deletion
 * @returns {DocumentFragment} Le bouton, la confirmation, le refus, ou un fragment vide.
 */
V.createDeleteFragment = function (canDelete, deletion) {
  if (!canDelete) {
    return htmlToFragment("");
  }
  if (deletion === null) {
    return htmlToFragment(templateDeleteButton);
  }
  if (deletion.blockedMessage !== null) {
    return htmlToFragment(genericRenderer(templateDeleteBlocked, { message: deletion.blockedMessage }));
  }

  let fragment = htmlToFragment(genericRenderer(templateDeleteConfirm, deletion));
  fragment.querySelector('[data-action="confirm-delete"]').disabled = deletion.isDeleting;

  return fragment;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @param {{id: string}} params - Paramètres de l'adresse.
 * @returns {Promise<DocumentFragment>}
 */
export function AdminProductPage(params) {
  return C.init(params);
}
