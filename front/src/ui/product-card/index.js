import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { formatPrice } from "../../lib/format.js";
import { StockBadgeView } from "../stock-badge/index.js";
import template from "./template.html?raw";
import templateImage from "./image.html?raw";
import templatePlaceholder from "./placeholder.html?raw";
import templateActionAdd from "./action-add.html?raw";
import templateActionChoose from "./action-choose.html?raw";
import templateActionSoldOut from "./action-sold-out.html?raw";

// Classes du prix, écrites en entier : rouge des promotions pour le produit
// en promotion automatique (PRO-c).
const PRICE_CLASSES = {
  promo: "text-accent",
  regular: "text-ink",
};

// Carte d'un produit, telle que la prépare le modèle de la page :
// { id, name, price, priceFrom, originalPrice, discountRate, imageUrl,
// variantId, stockStatus, isAdded } — price est celui de la variante la moins
// chère, précédé de « dès » si priceFrom (variantes à prix différents) ; originalPrice (prix avant remise) et discountRate
// (réduction en pour cent) valent null hors promotion (PRO-c) ; imageUrl
// vaut null sans photo ; variantId vaut null si le produit a plusieurs
// variantes (le bouton mène alors à la fiche) ; stockStatus est le statut de
// stock du produit (STK-b), « out » désactive l'ajout ; isAdded vaut true
// juste après un ajout au panier.
let ProductCardView = {
  /**
   * @param {{id: number, slug: string, name: string, price: number, priceFrom: boolean, originalPrice: ?number,
   *   discountRate: ?number, imageUrl: ?string, variantId: ?number,
   *   stockStatus: "in"|"low"|"out", isAdded: boolean}} product
   * @param {2|3} [headingLevel=2] - Niveau du titre de la carte (h2 ou h3).
   * @returns {string} Le HTML de la carte, sans son visuel ni son bouton
   *   (slots « visual » et « action »).
   */
  html: function (product, headingLevel = 2) {
    // Les valeurs sont mises en forme avant d'être passées au template.
    let isPromo = product.originalPrice !== null;
    return genericRenderer(template, {
      id: product.id,
      slug: product.slug,
      name: product.name,
      price: `${product.priceFrom ? "dès " : ""}${formatPrice(product.price)}`,
      originalPrice: isPromo ? formatPrice(product.originalPrice) : "",
      discountRate: product.discountRate ?? "",
      priceClasses: isPromo ? PRICE_CLASSES.promo : PRICE_CLASSES.regular,
      headingLevel: headingLevel,
    });
  },

  /**
   * @param {{id: number, slug: string, name: string, price: number, priceFrom: boolean, originalPrice: ?number,
   *   discountRate: ?number, imageUrl: ?string, variantId: ?number,
   *   stockStatus: "in"|"low"|"out", isAdded: boolean}} product
   * @param {2|3} headingLevel - Niveau du titre de la carte (h2 ou h3).
   * @param {{onAdd: (productId: number) => void}} actions
   * @returns {DocumentFragment} La carte, visuel et bouton compris.
   */
  dom: function (product, headingLevel, actions) {
    let fragment = htmlToFragment(ProductCardView.html(product, headingLevel));

    fragment.querySelector('slot[name="stock"]').replaceWith(StockBadgeView.dom(product.stockStatus));
    fragment.querySelector('slot[name="action"]').replaceWith(ProductCardView.action(product, actions));
    fragment.querySelector('slot[name="visual"]').replaceWith(ProductCardView.visual(product));

    // Un template n'a pas de condition : la promotion se retire ici.
    if (product.originalPrice === null) {
      fragment.querySelector("[data-discount]").remove();
      fragment.querySelector("[data-original-price]").remove();
    }

    return fragment;
  },

  /**
   * @param {Parameters<typeof ProductCardView.dom>[0]} product
   * @param {Parameters<typeof ProductCardView.dom>[2]} actions
   * @returns {DocumentFragment} « Épuisé » (désactivé) si le produit est
   *   épuisé, sinon « Ajouter au panier », ou « Choisir une option » si le
   *   produit a plusieurs variantes.
   */
  action: function (product, actions) {
    if (product.stockStatus === "out") {
      return htmlToFragment(genericRenderer(templateActionSoldOut, { name: product.name }));
    }

    if (product.variantId === null) {
      return htmlToFragment(genericRenderer(templateActionChoose, product));
    }

    let label = product.isAdded ? "Ajouté au panier ✓" : "Ajouter au panier";
    let fragment = htmlToFragment(genericRenderer(templateActionAdd, { name: product.name, label }));
    fragment.querySelector("[data-add-to-cart]").addEventListener("click", () => {
      actions.onAdd(product.id);
    });
    return fragment;
  },

  /**
   * @param {Parameters<typeof ProductCardView.dom>[0]} product
   * @returns {DocumentFragment} La photo, ou son remplaçant.
   */
  visual: function (product) {
    if (product.imageUrl === null) {
      return ProductCardView.placeholder(product.name);
    }

    let visual = htmlToFragment(genericRenderer(templateImage, product));
    let image = visual.querySelector("img");

    // Fichier absent ou illisible : on affiche le remplaçant plutôt qu'une
    // icône d'image cassée. C'est un état d'affichage, pas une donnée.
    image.addEventListener("error", () => {
      image.parentElement.replaceWith(ProductCardView.placeholder(product.name));
    });

    return visual;
  },

  /**
   * @param {string} name - Nom du produit, pour l'alternative textuelle.
   * @returns {DocumentFragment} Le visuel « Photo à venir ».
   */
  placeholder: function (name) {
    return htmlToFragment(genericRenderer(templatePlaceholder, { name }));
  },
};

export { ProductCardView };
