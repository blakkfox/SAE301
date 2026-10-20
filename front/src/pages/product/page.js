import { CartData } from "../../data/cart.js";
import { ProductData } from "../../data/product.js";
import { formatPrice } from "../../lib/format.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { MessageView } from "../../ui/message/index.js";
import { ProductFeaturesView } from "../../ui/product-features/index.js";
import { ProductCardView } from "../../ui/product-card/index.js";
import { ProductGalleryView } from "../../ui/product-gallery/index.js";
import { ProductGridView } from "../../ui/product-grid/index.js";
import { QuantityStepperView } from "../../ui/quantity-stepper/index.js";
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
 * Découpage MVC strict :
 *   M — état de la page, appel à l'API, préparation des données affichables ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Nombre d'emplacements de miniatures de la maquette. Les photos
// supplémentaires n'existent pas encore en base : les emplacements restants
// affichent « Photo à venir ».
const GALLERY_SLOTS = 4;

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
 * Ligne sous le titre : la référence, puis la catégorie.
 *
 * La référence est portée par la variante. Tant que le choix de variante
 * n'existe pas (OPT-b), elle n'est affichée que si le produit n'en a qu'une :
 * sinon, laquelle afficher serait arbitraire.
 *
 * @returns {string} Par exemple « Réf. HM-KTB-ALU-42 · Bagagerie ».
 */
M.getSubtitle = function () {
  let variants = M.product.variants;
  let category = M.product.category.name;

  if (variants.length === 1) {
    return `Réf. ${variants[0].reference} · ${category}`;
  }
  return category;
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
 * @returns {?{id: number, label: string, reference: string}} La variante
 *   choisie, ou null.
 */
M.getSelectedVariant = function () {
  return M.product.variants.find((variant) => variant.id === M.selectedVariantId) ?? null;
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
  }
};

/**
 * Change la quantité à ajouter, bornée entre 1 et le maximum du panier.
 *
 * @param {number} quantity
 */
M.setQuantity = function (quantity) {
  M.quantity = Math.min(Math.max(quantity, 1), CartData.MAX_QUANTITY);
};

/**
 * Ajoute la variante choisie au panier, et prépare le message à afficher.
 * La quantité revient ensuite à 1.
 */
M.addToCart = function () {
  let variant = M.getSelectedVariant();

  if (variant === null) {
    M.feedback = { type: "erreur", texte: "Choisissez d'abord une option ci-dessus." };
    return;
  }

  if (!CartData.add(variant.id, M.quantity)) {
    M.feedback = { type: "erreur", texte: "Le panier n'a pas pu être enregistré sur cet appareil." };
    return;
  }

  let label = M.product.variants.length > 1 ? ` (${variant.label})` : "";
  let count = M.quantity > 1 ? `${M.quantity} × ` : "";
  M.feedback = { type: "succes", texte: `${count}${M.product.name}${label} ajouté au panier.` };
  M.quantity = 1;
};

/**
 * Données du bloc d'achat : le sélecteur de variante (null s'il n'y a qu'une
 * variante) et le sélecteur de quantité.
 *
 * @returns {{picker: ?Parameters<typeof VariantPickerView.dom>[0],
 *   quantity: Parameters<typeof QuantityStepperView.dom>[0]}}
 */
M.getPurchaseData = function () {
  let selected = M.getSelectedVariant();
  let picker = null;

  if (M.product.variants.length > 1) {
    picker = {
      selectedLabel: selected === null ? "à sélectionner" : selected.label,
      options: M.product.variants.map((variant) => ({
        id: variant.id,
        label: variant.label,
        isSelected: variant.id === M.selectedVariantId,
      })),
    };
  }

  return {
    picker,
    quantity: {
      quantity: M.quantity,
      min: 1,
      max: CartData.MAX_QUANTITY,
      label: `Quantité de ${M.product.name}`,
      size: "large",
    },
  };
};

/**
 * Prépare un produit du bloc « Vous aimerez aussi » pour la carte produit.
 *
 * @param {{id: number, name: string, price: number, image: ?string, variantId: ?number}} product
 * @returns {{id: number, name: string, price: number, imageUrl: ?string,
 *   variantId: ?number, isAdded: boolean}}
 */
M.toCardData = function (product) {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    imageUrl: ProductData.imageUrl(product.image),
    variantId: product.variantId,
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
  if (product === undefined || product.variantId === null) return;

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
 *   subtitle: string, price: string, categoryName: string, categoryUrl: string},
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
  let fragment = htmlToFragment(templatePurchase);

  let variantsSlot = fragment.querySelector('slot[name="variants"]');
  if (purchaseData.picker === null) {
    variantsSlot.remove();
  } else {
    variantsSlot.replaceWith(VariantPickerView.dom(purchaseData.picker, { onSelect: C.handler_selectVariant }));
  }

  fragment
    .querySelector('slot[name="quantity"]')
    .replaceWith(QuantityStepperView.dom(purchaseData.quantity, { onChange: C.handler_changeQuantity }));

  fragment.querySelector("[data-add-to-cart]").addEventListener("click", C.handler_addToCart);

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
  let page = htmlToFragment(genericRenderer(template, data.page));

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
