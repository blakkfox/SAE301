import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { formatPrice } from "../../lib/format.js";
import template from "./template.html?raw";
import templateImage from "./image.html?raw";
import templatePlaceholder from "./placeholder.html?raw";
import templateActionAdd from "./action-add.html?raw";
import templateActionChoose from "./action-choose.html?raw";

// Carte d'un produit, telle que la prépare le modèle de la page :
// { id, name, price, imageUrl, variantId, isAdded } — imageUrl vaut null sans
// photo ; variantId vaut null si le produit a plusieurs variantes (le bouton
// mène alors à la fiche) ; isAdded vaut true juste après un ajout au panier.
let ProductCardView = {
  /**
   * @param {{id: number, name: string, price: number, imageUrl: ?string,
   *   variantId: ?number, isAdded: boolean}} product
   * @param {2|3} [headingLevel=2] - Niveau du titre de la carte (h2 ou h3).
   * @returns {string} Le HTML de la carte, sans son visuel ni son bouton
   *   (slots « visual » et « action »).
   */
  html: function (product, headingLevel = 2) {
    // Les valeurs sont mises en forme avant d'être passées au template.
    return genericRenderer(template, {
      id: product.id,
      name: product.name,
      price: formatPrice(product.price),
      headingLevel: headingLevel,
    });
  },

  /**
   * @param {{id: number, name: string, price: number, imageUrl: ?string,
   *   variantId: ?number, isAdded: boolean}} product
   * @param {2|3} headingLevel - Niveau du titre de la carte (h2 ou h3).
   * @param {{onAdd: (productId: number) => void}} actions
   * @returns {DocumentFragment} La carte, visuel et bouton compris.
   */
  dom: function (product, headingLevel, actions) {
    let fragment = htmlToFragment(ProductCardView.html(product, headingLevel));

    fragment.querySelector('slot[name="action"]').replaceWith(ProductCardView.action(product, actions));
    fragment.querySelector('slot[name="visual"]').replaceWith(ProductCardView.visual(product));

    return fragment;
  },

  /**
   * @param {Parameters<typeof ProductCardView.dom>[0]} product
   * @param {Parameters<typeof ProductCardView.dom>[2]} actions
   * @returns {DocumentFragment} « Ajouter au panier », ou « Choisir une option »
   *   si le produit a plusieurs variantes.
   */
  action: function (product, actions) {
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
