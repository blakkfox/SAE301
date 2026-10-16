import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { formatPrice } from "../../lib/format.js";
import template from "./template.html?raw";
import templateImage from "./image.html?raw";
import templatePlaceholder from "./placeholder.html?raw";

// Carte d'un produit, telle que la prépare le modèle de la page :
// { id, name, price, imageUrl } — imageUrl vaut null sans photo.
let ProductCardView = {
  /**
   * @param {{id: number, name: string, price: number, imageUrl: ?string}} product
   * @returns {string} Le HTML de la carte, sans son visuel (slot « visual »).
   */
  html: function (product) {
    // Les valeurs sont mises en forme avant d'être passées au template.
    return genericRenderer(template, {
      id: product.id,
      name: product.name,
      price: formatPrice(product.price),
    });
  },

  /**
   * @param {{id: number, name: string, price: number, imageUrl: ?string}} product
   * @returns {DocumentFragment} La carte, visuel compris.
   */
  dom: function (product) {
    let fragment = htmlToFragment(ProductCardView.html(product));
    let slot = fragment.querySelector('slot[name="visual"]');

    if (product.imageUrl === null) {
      slot.replaceWith(ProductCardView.placeholder(product.name));
      return fragment;
    }

    let visual = htmlToFragment(genericRenderer(templateImage, product));
    let image = visual.querySelector("img");

    // Fichier absent ou illisible : on affiche le remplaçant plutôt qu'une
    // icône d'image cassée. C'est un état d'affichage, pas une donnée.
    image.addEventListener("error", () => {
      image.parentElement.replaceWith(ProductCardView.placeholder(product.name));
    });

    slot.replaceWith(visual);
    return fragment;
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
