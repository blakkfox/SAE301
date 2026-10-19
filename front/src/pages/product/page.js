import { ProductData } from "../../data/product.js";
import { formatPrice } from "../../lib/format.js";
import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { ProductFeaturesView } from "../../ui/product-features/index.js";
import { ProductGalleryView } from "../../ui/product-gallery/index.js";
import { ProductGridView } from "../../ui/product-grid/index.js";
import template from "./template.html?raw";
import templateBreadcrumbParent from "./breadcrumb-parent.html?raw";
import templateDescription from "./description.html?raw";
import templateRelated from "./related.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Fiche produit » — US DEC-c (écran Figma n° 2), route /produits/:id.
 *
 * Comme les pages du starter, C.init attend la réponse de l'API avant de
 * rendre la page : le routeur l'insère ensuite et complète lui-même ses liens
 * (chemin du projet, aria-current). Le clic sur une miniature ne reconstruit
 * que la galerie, qui ne contient aucun lien.
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
};

/**
 * Remet la page dans son état initial, avant l'affichage d'un produit.
 */
M.reset = function () {
  M.product = null;
  M.related = [];
  M.error = null;
  M.selectedImage = 0;
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
 * Rassemble tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{error: ?{title: string, text: string}, page: ?{name: string,
 *   subtitle: string, price: string, categoryName: string, categoryUrl: string},
 *   parent: ?{name: string, url: string}, description: ?string, gallery: ?Object,
 *   features: Array<{label: string, value: string}>,
 *   related: Array<{id: number, name: string, price: number, imageUrl: ?string}>}}
 */
M.getViewData = function () {
  if (M.product === null) {
    return { error: M.error, page: null, parent: null, description: null, gallery: null, features: [], related: [] };
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
    features: M.product.features,
    related: M.related.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      imageUrl: ProductData.imageUrl(product.image),
    })),
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

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  gallery: null, // élément racine de la galerie affichée
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

  let descriptionSlot = page.querySelector('slot[name="description"]');
  if (data.description === null) {
    descriptionSlot.remove();
  } else {
    descriptionSlot.replaceWith(htmlToFragment(genericRenderer(templateDescription, { description: data.description })));
  }

  page.querySelector('slot[name="features"]').replaceWith(ProductFeaturesView.dom(data.features));

  let relatedSlot = page.querySelector('slot[name="related"]');
  if (data.related.length === 0) {
    relatedSlot.remove();
  } else {
    let related = htmlToFragment(templateRelated);
    // Cartes en h3 : elles sont sous le h2 « Vous aimerez aussi ».
    related.querySelector('slot[name="grid"]').replaceWith(ProductGridView.dom(data.related, 3));
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
