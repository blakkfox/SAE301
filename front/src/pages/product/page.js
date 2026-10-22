import { CartData } from "../../data/cart.js";
import { ProductData } from "../../data/product.js";
import { formatPrice } from "../../lib/format.js";
import { getStockStatus } from "../../lib/stock.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { MessageView } from "../../ui/message/index.js";
import { ProductFeaturesView } from "../../ui/product-features/index.js";
import { ProductCardView } from "../../ui/product-card/index.js";
import { ProductGalleryView } from "../../ui/product-gallery/index.js";
import { ProductGridView } from "../../ui/product-grid/index.js";
import { ProductOptionsView } from "../../ui/product-options/index.js";
import { QuantityStepperView } from "../../ui/quantity-stepper/index.js";
import { StockBadgeView } from "../../ui/stock-badge/index.js";
import { VariantPickerView } from "../../ui/variant-picker/index.js";
import template from "./template.html?raw";
import templateBreadcrumbParent from "./breadcrumb-parent.html?raw";
import templateDescription from "./description.html?raw";
import templateRelated from "./related.html?raw";
import templateError from "./error.html?raw";
import templatePurchase from "./purchase.html?raw";
import templateFeedback from "./feedback.html?raw";

/**
 * Page « Fiche produit » — US DEC-c (écran Figma n° 2), route /produits/:id.
 *
 * Comme les pages du starter, C.init attend la réponse de l'API avant de
 * rendre la page : le routeur l'insère ensuite et complète lui-même ses liens
 * (chemin du projet, aria-current). Le clic sur une miniature ne reconstruit
 * que la galerie, qui ne contient aucun lien.
 *
 * Ajout au panier (CMD-b) : le choix de la variante et de la quantité ne
 * reconstruit que le bloc d'achat. Le panier lui-même est géré par
 * data/cart.js ; le compteur de l'en-tête se met à jour seul (voir le layout).
 *
 * Stocks (STK-b) : la pastille à côté du prix donne le stock de la variante
 * choisie, ou celui du produit tant qu'aucune ne l'est. Une variante épuisée
 * est barrée, et le bouton devient « Épuisé », désactivé.
 *
 * Contraintes de stock (STK-c) : la quantité à ajouter ne dépasse pas le
 * stock de la variante choisie, moins ce qui est déjà dans le panier.
 *
 * Options (OPT-c) : les cases cochées s'ajoutent au prix d'un article
 * (« Prix avec options ») et au montant du bouton d'ajout. Elles sont
 * enregistrées avec la ligne du panier (OPT-a) : si la variante y est déjà,
 * les options cochées remplacent les siennes, et le message d'ajout le dit.
 *
 * Variantes (OPT-b, écran 18) : le sélecteur nomme le type de variante du
 * produit (« Taille : M »), signale les variantes bientôt épuisées, donne le
 * stock restant de celle choisie et liste les épuisées ; le guide des tailles
 * s'ouvre pour un produit à tailles. La référence de la variante choisie
 * s'affiche sous le bouton d'ajout.
 *
 * Découpage MVC strict :
 *   M — état de la page, appel à l'API, préparation des données affichables ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Nombre d'emplacements de miniatures de la maquette. Les photos
// supplémentaires n'existent pas encore en base : les emplacements restants
// affichent « Photo à venir ».
const GALLERY_SLOTS = 4;

// Classes du prix, écrites en entier : rouge des promotions pour le produit
// en promotion automatique (PRO-c).
const PRICE_CLASSES = {
  promo: "text-accent",
  regular: "text-ink",
};

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  product: null, // produit renvoyé par l'API, ou null
  related: [], // produits du bloc « Vous aimerez aussi »
  error: null, // { title, text } à afficher, ou null
  selectedImage: 0, // indice de la photo affichée en grand
  selectedVariantId: null, // variante choisie, ou null tant qu'aucune ne l'est
  quantity: 1, // quantité à ajouter au panier
  selectedOptionIds: [], // options cochées (OPT-c), dans l'ordre d'affichage
  feedback: null, // { type: "succes" | "erreur", texte } après « Ajouter au panier », ou null
  addedProductId: null, // produit de la dernière carte « Vous aimerez aussi » ajoutée, ou null
  cartStatus: null, // confirmation d'ajout depuis une carte, à annoncer, ou null
};

/**
 * Remet la page dans son état initial, avant l'affichage d'un produit.
 */
M.reset = function () {
  M.product = null;
  M.related = [];
  M.error = null;
  M.selectedImage = 0;
  M.selectedVariantId = null;
  M.quantity = 1;
  M.selectedOptionIds = [];
  M.feedback = null;
  M.addedProductId = null;
  M.cartStatus = null;
};

/**
 * Charge la fiche d'un produit et range la réponse dans le modèle.
 *
 * @param {string} id - Identifiant lu dans l'adresse (/produits/:id).
 * @returns {Promise<void>}
 */
M.loadProduct = async function (id) {
  try {
    let response = await ProductData.fetchOne(id);
    M.product = response.product;
    M.related = response.related;

    // Une seule variante : elle est choisie d'office, sans sélecteur.
    if (M.product.variants.length === 1) {
      M.selectedVariantId = M.product.variants[0].id;
    }
  } catch (error) {
    // 400 (identifiant invalide) et 404 (produit absent) ont le même sens
    // pour le client : ce produit n'existe pas.
    if (error.statut === 400 || error.statut === 404) {
      M.error = {
        title: "Produit introuvable",
        text: "Ce produit n'existe pas ou n'est plus disponible.",
      };
    } else {
      M.error = {
        title: "Fiche indisponible",
        text: `Impossible de charger le produit : ${error.message}`,
      };
    }
  }
};

/**
 * Photos du produit. Une seule pour l'instant : la table des photos
 * supplémentaires sera ajoutée plus tard.
 *
 * @returns {string[]} Adresses des photos.
 */
M.getImageUrls = function () {
  let url = ProductData.imageUrl(M.product.image);
  return url === null ? [] : [url];
};

/**
 * Sélectionne la photo à afficher en grand, si l'indice existe.
 *
 * @param {number} index - Indice de la miniature cliquée.
 */
M.selectImage = function (index) {
  if (index >= 0 && index < M.getImageUrls().length) {
    M.selectedImage = index;
  }
};

/**
 * Ligne sous le titre : la catégorie, puis la matière si le produit a cette
 * caractéristique, comme sur la maquette (écran 18). La référence, portée par
 * la variante, est affichée sous le bouton d'ajout (OPT-b).
 *
 * @returns {string} Par exemple « T-shirts · 100 % coton, 200 g/m² ».
 */
M.getSubtitle = function () {
  let material = M.product.features.find((feature) => feature.label === "Matière");
  let category = M.product.category.name;
  return material === undefined ? category : `${category} · ${material.value}`;
};

/**
 * Données de la galerie.
 *
 * @returns {{name: string, mainUrl: ?string,
 *   thumbnails: Array<{index: number, url: string, isSelected: boolean}>,
 *   emptySlots: number}}
 */
M.getGalleryData = function () {
  let urls = M.getImageUrls();

  return {
    name: M.product.name,
    mainUrl: urls[M.selectedImage] ?? null,
    thumbnails: urls.map((url, index) => ({ index, url, isSelected: index === M.selectedImage })),
    emptySlots: Math.max(0, GALLERY_SLOTS - urls.length),
  };
};

/**
 * @returns {?{id: number, label: string, reference: string, stock: number}} La
 *   variante choisie, ou null.
 */
M.getSelectedVariant = function () {
  return M.product.variants.find((variant) => variant.id === M.selectedVariantId) ?? null;
};

/**
 * Type de variante du produit (« Taille », « Coloris »…), ou « Choix » si la
 * base ne le précise pas.
 *
 * @returns {string}
 */
M.getVariantAxis = function () {
  return M.product.variantAxis ?? "Choix";
};

/**
 * Libellé complet d'une variante, tel que le panier l'affiche : « Taille M »
 * pour « M » (voir ProductModel::VARIANT_LABEL côté serveur).
 *
 * @param {{label: string}} variant
 * @returns {string}
 */
M.getFullLabel = function (variant) {
  return M.product.variantAxis === null ? variant.label : `${M.product.variantAxis} ${variant.label}`;
};

/**
 * Stock restant de la variante choisie, s'il est bas (OPT-b) : « Plus qu'1
 * en taille M ». Le nombre exact aide à se décider ; au-delà du seuil
 * « Bientôt épuisé » du produit, « En stock » suffit et rien n'est affiché.
 *
 * @returns {?string} Le texte, ou null.
 */
M.getStockNote = function () {
  let selected = M.getSelectedVariant();
  if (selected === null || getStockStatus(selected.stock, M.product.lowStockThreshold) !== "low") return null;

  // Élision devant « 1 » (« un ») seulement.
  let count = selected.stock === 1 ? "Plus qu'1" : `Plus que ${selected.stock}`;
  let axis = M.product.variantAxis;
  return axis === null ? `${count} : ${selected.label}` : `${count} en ${axis.toLowerCase()} ${selected.label}`;
};

/**
 * Variantes épuisées, rappelées sous les choix (OPT-b) : « L : épuisé ».
 *
 * @returns {?string} Le texte, ou null si aucune n'est épuisée.
 */
M.getSoldOutNote = function () {
  let labels = M.product.variants.filter((variant) => variant.stock <= 0).map((variant) => variant.label);
  if (labels.length === 0) return null;
  return labels.length === 1 ? `${labels[0]} : épuisé` : `${labels.join(", ")} : épuisés`;
};

/**
 * Statut de stock affiché à côté du prix : celui de la variante choisie, ou
 * celui du stock total du produit tant qu'aucune variante ne l'est.
 *
 * @returns {"in"|"low"|"out"}
 */
M.getStockStatus = function () {
  let selected = M.getSelectedVariant();
  let stock = selected === null
    ? M.product.variants.reduce((total, variant) => total + variant.stock, 0)
    : selected.stock;
  return getStockStatus(stock, M.product.lowStockThreshold);
};

/**
 * Choisit la variante à ajouter au panier, si elle appartient au produit.
 *
 * @param {number} variantId
 */
M.selectVariant = function (variantId) {
  if (M.product.variants.some((variant) => variant.id === variantId)) {
    M.selectedVariantId = variantId;
    M.feedback = null;
    M.setQuantity(M.quantity);
  }
};

/**
 * Coche ou décoche une option, si elle appartient au produit. Les options
 * cochées restent dans l'ordre d'affichage.
 *
 * @param {number} optionId
 * @param {boolean} isSelected - true pour cocher, false pour décocher.
 */
M.toggleOption = function (optionId, isSelected) {
  if (!M.product.options.some((option) => option.id === optionId)) return;

  M.selectedOptionIds = M.product.options
    .map((option) => option.id)
    .filter((id) => (id === optionId ? isSelected : M.selectedOptionIds.includes(id)));
  M.feedback = null;
};

/**
 * @returns {Array<{id: number, label: string, description: ?string, price: number}>}
 *   Les options cochées, dans l'ordre d'affichage.
 */
M.getSelectedOptions = function () {
  return M.product.options.filter((option) => M.selectedOptionIds.includes(option.id));
};

/**
 * Prix d'un article avec les options cochées. Calculé pour l'affichage
 * seulement : le serveur recalcule les suppléments à la commande (OPT-a).
 *
 * @returns {number}
 */
M.getUnitPrice = function () {
  return M.getSelectedOptions().reduce((total, option) => total + option.price, M.product.price);
};

/**
 * Quantité maximale à ajouter (STK-c) : ce qui reste du stock de la variante
 * choisie une fois déduit le panier, ou le maximum du panier tant qu'aucune
 * ne l'est. Au moins 1, pour que le sélecteur reste lisible.
 *
 * @returns {number}
 */
M.getMaxQuantity = function () {
  let variant = M.getSelectedVariant();
  let remaining = variant === null ? CartData.MAX_QUANTITY : CartData.remainingFor(variant.id, variant.stock);
  return Math.max(1, remaining);
};

/**
 * Change la quantité à ajouter, bornée entre 1 et M.getMaxQuantity().
 *
 * @param {number} quantity
 */
M.setQuantity = function (quantity) {
  M.quantity = Math.min(Math.max(quantity, 1), M.getMaxQuantity());
};

/**
 * Ajoute la variante choisie au panier, et prépare le message à afficher.
 * La quantité revient ensuite à 1.
 */
M.addToCart = function () {
  let variant = M.getSelectedVariant();

  // « votre » plutôt qu'un article : « taille » et « coloris » n'ont pas le même genre.
  let axis = M.getVariantAxis().toLowerCase();

  if (variant === null) {
    M.feedback = { type: "erreur", texte: `Choisissez d'abord votre ${axis} ci-dessus.` };
    return;
  }

  if (variant.stock <= 0) {
    M.feedback = { type: "erreur", texte: `${M.getFullLabel(variant)} : épuisé. Faites un autre choix ci-dessus.` };
    return;
  }

  // Le panier a pu changer dans un autre onglet : la limite est relue.
  let remaining = CartData.remainingFor(variant.id, variant.stock);
  if (remaining === 0) {
    M.feedback = {
      type: "erreur",
      texte: "Vous avez déjà dans votre panier la quantité maximale disponible pour cet article.",
    };
    return;
  }
  M.quantity = Math.min(M.quantity, remaining);

  // Options de la ligne déjà au panier, remplacées par l'ajout si elles diffèrent.
  let previous = CartData.optionsOf(variant.id);
  let hasReplaced = previous.length > 0 && previous.join(",") !== M.selectedOptionIds.join(",");

  if (!CartData.add(variant.id, M.quantity, M.selectedOptionIds)) {
    M.feedback = { type: "erreur", texte: "Le panier n'a pas pu être enregistré sur cet appareil." };
    return;
  }

  M.feedback = { type: "succes", texte: M.formatAddedMessage(variant, hasReplaced) };
  M.quantity = 1;
};

/**
 * Message de confirmation d'un ajout au panier, avec les options choisies
 * (OPT-a). Si la ligne du panier avait d'autres options, elles ont été
 * remplacées par celles-ci : le message le précise.
 *
 * @param {{label: string}} variant - Variante ajoutée.
 * @param {boolean} hasReplaced - Les options de la ligne du panier ont changé.
 * @returns {string}
 */
M.formatAddedMessage = function (variant, hasReplaced) {
  let label = M.product.variants.length > 1 ? ` (${M.getFullLabel(variant)})` : "";
  let count = M.quantity > 1 ? `${M.quantity} × ` : "";
  let options = M.getSelectedOptions().map((option) => option.label);
  let text = `${count}${M.product.name}${label} ajouté au panier`;

  if (options.length > 0) {
    text += ` avec : ${options.join(", ")}`;
  }
  text += ".";

  if (hasReplaced) {
    text +=
      options.length > 0
        ? " Ces options remplacent celles de l'article déjà dans votre panier."
        : " L'article de votre panier n'a plus d'option.";
  }
  return text;
};

/**
 * Données du bloc « Options » (OPT-c), ou null si le produit n'en a aucune.
 *
 * @returns {?Parameters<typeof ProductOptionsView.dom>[0]}
 */
M.getOptionsData = function () {
  if (M.product.options.length === 0) return null;

  return {
    total: formatPrice(M.getUnitPrice()),
    options: M.product.options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description ?? "",
      price: `+ ${formatPrice(option.price)}`,
      isSelected: M.selectedOptionIds.includes(option.id),
    })),
  };
};

/**
 * Données du sélecteur de variante (OPT-b), ou null s'il n'y a qu'une
 * variante : rien à choisir.
 *
 * @returns {?Parameters<typeof VariantPickerView.dom>[0]}
 */
M.getPickerData = function () {
  if (M.product.variants.length === 1) return null;

  let selected = M.getSelectedVariant();

  return {
    legend: `${M.getVariantAxis()} : ${selected === null ? "à sélectionner" : selected.label}`,
    stockNote: M.getStockNote(),
    soldOutNote: M.getSoldOutNote(),
    hasSizeGuide: M.product.variantAxis === "Taille",
    options: M.product.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      isSelected: variant.id === M.selectedVariantId,
      stockStatus: getStockStatus(variant.stock, M.product.lowStockThreshold),
    })),
  };
};

/**
 * Référence de la variante choisie, affichée sous le bouton (OPT-b), ou null
 * tant qu'aucune ne l'est.
 *
 * @returns {?string} « Réf. variante : HM-TSH-CBR-M », ou « Réf. : HM-PCL-RW »
 *   pour un produit à variante unique.
 */
M.getReferenceText = function () {
  let selected = M.getSelectedVariant();
  if (selected === null) return null;
  return M.product.variants.length > 1 ? `Réf. variante : ${selected.reference}` : `Réf. : ${selected.reference}`;
};

/**
 * Données du bloc d'achat : le sélecteur de variante (null s'il n'y a qu'une
 * variante), les options (null si le produit n'en a pas), le sélecteur de
 * quantité, le bouton, « Épuisé » et désactivé si la variante choisie, ou
 * le produit entier, est épuisé, et la référence de la variante choisie. Un
 * produit à options affiche dans le bouton le montant à ajouter, options
 * comprises, comme sur la maquette (écran 16).
 *
 * @returns {{picker: ?ReturnType<typeof M.getPickerData>,
 *   options: ?ReturnType<typeof M.getOptionsData>,
 *   quantity: Parameters<typeof QuantityStepperView.dom>[0],
 *   addLabel: string, isSoldOut: boolean, reference: ?string}}
 */
M.getPurchaseData = function () {
  let isSoldOut = M.getStockStatus() === "out";
  let options = M.getOptionsData();

  let addLabel = "Ajouter au panier";
  if (isSoldOut) {
    addLabel = "Épuisé";
  } else if (options !== null) {
    addLabel = `Ajouter au panier · ${formatPrice(M.getUnitPrice() * M.quantity)}`;
  }

  return {
    picker: M.getPickerData(),
    options,
    quantity: {
      quantity: M.quantity,
      min: 1,
      max: M.getMaxQuantity(),
      label: `Quantité de ${M.product.name}`,
      size: "large",
    },
    addLabel,
    isSoldOut,
    reference: M.getReferenceText(),
  };
};

/**
 * Prépare un produit du bloc « Vous aimerez aussi » pour la carte produit.
 *
 * @param {{id: number, name: string, price: number, originalPrice: ?number,
 *   discountRate: ?number, image: ?string, variantId: ?number, stock: number, lowStockThreshold: number}} product
 * @returns {{id: number, name: string, price: number, originalPrice: ?number,
 *   discountRate: ?number, imageUrl: ?string, variantId: ?number,
 *   stockStatus: "in"|"low"|"out", isAdded: boolean}}
 */
M.toCardData = function (product) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    originalPrice: product.originalPrice,
    discountRate: product.discountRate,
    imageUrl: ProductData.imageUrl(product.image),
    variantId: product.variantId,
    stockStatus: getStockStatus(product.stock, product.lowStockThreshold),
    isAdded: product.id === M.addedProductId,
  };
};

/**
 * Ajoute au panier le produit d'une carte « Vous aimerez aussi ». Seuls les
 * produits à variante unique ont un bouton d'ajout : la variante est lue dans
 * le modèle, jamais dans la page. Prépare la confirmation à annoncer.
 *
 * @param {number} productId - Produit de la carte cliquée.
 */
M.addRelatedToCart = function (productId) {
  let product = M.related.find((candidate) => candidate.id === productId);
  if (product === undefined || product.variantId === null || product.stock <= 0) return;

  if (CartData.remainingFor(product.variantId, product.stock) === 0) {
    M.addedProductId = null;
    M.cartStatus = `Votre panier contient déjà tout le stock disponible de ${product.name}.`;
    return;
  }

  if (CartData.add(product.variantId, 1)) {
    M.addedProductId = productId;
    M.cartStatus = `${product.name} ajouté au panier.`;
  } else {
    M.addedProductId = null;
    M.cartStatus = "Le panier n'a pas pu être enregistré sur cet appareil.";
  }
};

/**
 * @param {number} productId
 * @returns {?ReturnType<typeof M.toCardData>} La carte d'un produit suggéré, ou null.
 */
M.getRelatedCard = function (productId) {
  let product = M.related.find((candidate) => candidate.id === productId);
  return product === undefined ? null : M.toCardData(product);
};

/**
 * Rassemble tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{error: ?{title: string, text: string}, page: ?{name: string,
 *   subtitle: string, price: string, isPromo: boolean, originalPrice: string,
 *   discountRate: string, stockStatus: "in"|"low"|"out",
 *   categoryName: string, categoryUrl: string},
 *   parent: ?{name: string, url: string}, description: ?string, gallery: ?Object,
 *   purchase: ?ReturnType<typeof M.getPurchaseData>,
 *   features: Array<{label: string, value: string}>,
 *   related: Array<ReturnType<typeof M.toCardData>>}}
 */
M.getViewData = function () {
  if (M.product === null) {
    return {
      error: M.error,
      page: null,
      parent: null,
      description: null,
      gallery: null,
      purchase: null,
      features: [],
      related: [],
    };
  }

  let parent = M.product.category.parent;

  return {
    error: null,
    page: {
      name: M.product.name,
      subtitle: M.getSubtitle(),
      price: formatPrice(M.product.price),
      isPromo: M.product.originalPrice !== null,
      originalPrice: M.product.originalPrice === null ? "" : formatPrice(M.product.originalPrice),
      discountRate: M.product.discountRate === null ? "" : String(M.product.discountRate),
      stockStatus: M.getStockStatus(),
      categoryName: M.product.category.name,
      categoryUrl: `/categories/${M.product.category.slug}`,
    },
    parent: parent === null ? null : { name: parent.name, url: `/categories/${parent.slug}` },
    description: M.product.description,
    gallery: M.getGalleryData(),
    purchase: M.getPurchaseData(),
    features: M.product.features,
    related: M.related.map(M.toCardData),
  };
};

// ---------------------------------------------------------------------------
// C — Contrôleur
// ---------------------------------------------------------------------------

let C = {};

/**
 * Point d'entrée de la page, appelé par le routeur avec les paramètres de
 * l'adresse. Le routeur attend la promesse avant d'afficher la page.
 *
 * @param {{id: string}} params - Paramètres de la route /produits/:id.
 * @returns {Promise<DocumentFragment>}
 */
C.init = async function (params) {
  M.reset();
  await M.loadProduct(params.id);
  return V.init(M.getViewData());
};

/**
 * Clic sur une miniature : la photo correspondante passe en grand.
 *
 * @param {number} index - Indice de la miniature cliquée.
 */
C.handler_selectImage = function (index) {
  M.selectImage(index);
  V.renderGallery(M.getGalleryData());
};

/**
 * Choix d'une variante (taille, coloris…).
 *
 * @param {number} variantId
 */
C.handler_selectVariant = function (variantId) {
  M.selectVariant(variantId);
  V.renderPurchase(M.getPurchaseData());
  V.renderStock(M.getStockStatus());
  V.renderFeedback(M.feedback);
};

/**
 * Case d'option cochée ou décochée : le prix avec options et le montant du
 * bouton suivent.
 *
 * @param {number} optionId
 * @param {boolean} isSelected - Nouvel état de la case.
 */
C.handler_toggleOption = function (optionId, isSelected) {
  M.toggleOption(optionId, isSelected);
  V.renderPurchase(M.getPurchaseData());
  V.renderFeedback(M.feedback);
};

/**
 * Clic sur « − » ou « + » du sélecteur de quantité.
 *
 * @param {number} quantity - Quantité demandée.
 */
C.handler_changeQuantity = function (quantity) {
  M.setQuantity(quantity);
  V.renderPurchase(M.getPurchaseData());
};

/**
 * Clic sur « Ajouter au panier » d'une carte « Vous aimerez aussi » : la
 * carte affiche « Ajouté au panier ✓ » et la confirmation est annoncée.
 *
 * @param {number} productId - Produit de la carte cliquée.
 */
C.handler_addRelatedToCart = function (productId) {
  let previous = M.addedProductId;
  M.addRelatedToCart(productId);

  // La carte précédemment « ajoutée » redevient « Ajouter au panier ».
  if (previous !== null && previous !== productId) {
    V.renderRelatedCard(M.getRelatedCard(previous));
  }
  V.renderRelatedCard(M.getRelatedCard(productId));
  V.renderCartStatus(M.cartStatus);
};

/**
 * Clic sur « Ajouter au panier ».
 */
C.handler_addToCart = function () {
  M.addToCart();
  V.renderPurchase(M.getPurchaseData());
  V.renderFeedback(M.feedback);
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  gallery: null, // élément racine de la galerie affichée
  purchase: null, // bloc d'achat affiché
  feedback: null, // zone du message d'ajout au panier
  stock: null, // zone de la pastille de stock, à côté du prix
  related: null, // bloc « Vous aimerez aussi » affiché, ou null
};

/**
 * Premier affichage : la fiche, ou le message d'erreur.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  if (data.error !== null) {
    return htmlToFragment(genericRenderer(templateError, data.error));
  }
  return V.createPageFragment(data);
};

/**
 * Reconstruit la galerie seule, à partir des données reçues.
 *
 * @param {ReturnType<typeof M.getGalleryData>} galleryData
 */
V.renderGallery = function (galleryData) {
  let fragment = V.createGalleryFragment(galleryData);
  let newGallery = fragment.firstElementChild;
  V.gallery.replaceWith(fragment);
  V.gallery = newGallery;
};

/**
 * Reconstruit le bloc d'achat, en gardant le focus sur l'élément utilisé.
 *
 * @param {ReturnType<typeof M.getPurchaseData>} purchaseData
 */
V.renderPurchase = function (purchaseData) {
  V.purchase = replaceKeepingFocus(V.purchase, V.createPurchaseFragment(purchaseData));
};

/**
 * Affiche la pastille de stock à côté du prix (zone role="status" : le
 * changement est annoncé).
 *
 * @param {"in"|"low"|"out"} status
 */
V.renderStock = function (status) {
  V.stock.replaceChildren(StockBadgeView.dom(status));
};

/**
 * Affiche le message d'ajout au panier, ou aucun.
 *
 * @param {?{type: "succes"|"erreur", texte: string}} feedback
 */
V.renderFeedback = function (feedback) {
  if (feedback !== null && feedback.type === "succes") {
    V.feedback.replaceChildren(htmlToFragment(genericRenderer(templateFeedback, { text: feedback.texte })));
  } else {
    V.feedback.replaceChildren(MessageView.dom(feedback));
  }
};

/**
 * @param {ReturnType<typeof M.getPurchaseData>} purchaseData
 * @returns {DocumentFragment} Le bloc d'achat, relié au contrôleur.
 */
V.createPurchaseFragment = function (purchaseData) {
  let fragment = htmlToFragment(
    genericRenderer(templatePurchase, { addLabel: purchaseData.addLabel, reference: purchaseData.reference ?? "" })
  );

  if (purchaseData.reference === null) {
    fragment.querySelector("[data-variant-reference]").remove();
  }

  let variantsSlot = fragment.querySelector('slot[name="variants"]');
  if (purchaseData.picker === null) {
    variantsSlot.remove();
  } else {
    variantsSlot.replaceWith(VariantPickerView.dom(purchaseData.picker, { onSelect: C.handler_selectVariant }));
  }

  let optionsSlot = fragment.querySelector('slot[name="options"]');
  if (purchaseData.options === null) {
    optionsSlot.remove();
  } else {
    optionsSlot.replaceWith(ProductOptionsView.dom(purchaseData.options, { onToggle: C.handler_toggleOption }));
  }

  fragment
    .querySelector('slot[name="quantity"]')
    .replaceWith(QuantityStepperView.dom(purchaseData.quantity, { onChange: C.handler_changeQuantity }));

  let button = fragment.querySelector("[data-add-to-cart]");
  button.disabled = purchaseData.isSoldOut;
  button.addEventListener("click", C.handler_addToCart);

  return fragment;
};

/**
 * Reconstruit une carte « Vous aimerez aussi », en gardant le focus sur son bouton.
 *
 * @param {?ReturnType<typeof M.toCardData>} card
 */
V.renderRelatedCard = function (card) {
  if (card === null || V.related === null) return;
  let element = V.related.querySelector(`[data-product-id="${card.id}"]`);
  if (element === null) return;
  // Cartes en h3 : elles sont sous le h2 « Vous aimerez aussi ».
  replaceKeepingFocus(element, ProductCardView.dom(card, 3, { onAdd: C.handler_addRelatedToCart }));
};

/**
 * Annonce la confirmation d'ajout depuis une carte (zone role="status" de la grille).
 *
 * @param {?string} text
 */
V.renderCartStatus = function (text) {
  let status = V.related?.querySelector("[data-grid-status]") ?? null;
  if (status !== null) {
    status.textContent = text ?? "";
  }
};

/**
 * @param {ReturnType<typeof M.getGalleryData>} galleryData
 * @returns {DocumentFragment} La galerie, reliée au contrôleur.
 */
V.createGalleryFragment = function (galleryData) {
  return ProductGalleryView.dom(galleryData, { onSelect: C.handler_selectImage });
};

/**
 * Construit le fragment de la fiche : chaque slot reçoit son composant, ou
 * disparaît s'il n'a rien à afficher.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.createPageFragment = function (data) {
  let priceClasses = data.page.isPromo ? PRICE_CLASSES.promo : PRICE_CLASSES.regular;
  let page = htmlToFragment(genericRenderer(template, { ...data.page, priceClasses }));

  // Un template n'a pas de condition : la promotion (PRO-c) se retire ici.
  if (!data.page.isPromo) {
    for (const element of page.querySelectorAll("[data-promo]")) {
      element.remove();
    }
  }

  let parentSlot = page.querySelector('slot[name="breadcrumb-parent"]');
  if (data.parent === null) {
    parentSlot.remove();
  } else {
    parentSlot.replaceWith(htmlToFragment(genericRenderer(templateBreadcrumbParent, data.parent)));
  }

  let gallery = V.createGalleryFragment(data.gallery);
  V.gallery = gallery.firstElementChild;
  page.querySelector('slot[name="gallery"]').replaceWith(gallery);

  let purchase = V.createPurchaseFragment(data.purchase);
  V.purchase = purchase.firstElementChild;
  page.querySelector('slot[name="purchase"]').replaceWith(purchase);
  V.feedback = page.querySelector("[data-purchase-feedback]");

  V.stock = page.querySelector("[data-product-stock]");
  V.renderStock(data.page.stockStatus);

  let descriptionSlot = page.querySelector('slot[name="description"]');
  if (data.description === null) {
    descriptionSlot.remove();
  } else {
    descriptionSlot.replaceWith(htmlToFragment(genericRenderer(templateDescription, { description: data.description })));
  }

  page.querySelector('slot[name="features"]').replaceWith(ProductFeaturesView.dom(data.features));

  let relatedSlot = page.querySelector('slot[name="related"]');
  V.related = null;
  if (data.related.length === 0) {
    relatedSlot.remove();
  } else {
    let related = htmlToFragment(templateRelated);
    // Cartes en h3 : elles sont sous le h2 « Vous aimerez aussi ».
    related
      .querySelector('slot[name="grid"]')
      .replaceWith(ProductGridView.dom(data.related, 3, { onAdd: C.handler_addRelatedToCart }));
    V.related = related.firstElementChild;
    relatedSlot.replaceWith(related);
  }

  return page;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @param {{id: string}} params - Paramètres de la route /produits/:id.
 * @returns {Promise<DocumentFragment>}
 */
export function ProductPage(params) {
  return C.init(params);
}
