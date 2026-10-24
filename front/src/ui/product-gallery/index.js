import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import template from "./template.html?raw";
import templateMainImage from "./main-image.html?raw";
import templateMainPlaceholder from "./main-placeholder.html?raw";
import templateThumbnail from "./thumbnail.html?raw";
import templateThumbnailPlaceholder from "./thumbnail-placeholder.html?raw";

// Galerie de la fiche produit. Le composant ne décide de rien : il reçoit les
// photos déjà préparées (laquelle est sélectionnée, quelles miniatures) et
// signale le clic sur une miniature par actions.onSelect.
let ProductGalleryView = {
  /**
   * @param {{name: string, mainUrl: ?string,
   *   thumbnails: Array<{index: number, url: string, isSelected: boolean}>}} data
   * @param {{onSelect: (index: number) => void}} actions
   * @returns {DocumentFragment}
   */
  dom: function (data, actions) {
    let fragment = htmlToFragment(template);

    fragment.querySelector('slot[name="main"]').replaceWith(ProductGalleryView.main(data.name, data.mainUrl));

    let thumbnails = data.thumbnails.map((thumbnail) => {
      let item = htmlToFragment(
        genericRenderer(templateThumbnail, { ...thumbnail, number: thumbnail.index + 1 })
      );
      // Un template n'a pas de condition : la sélection se règle ici.
      item.querySelector("button").setAttribute("aria-pressed", String(thumbnail.isSelected));

      // Photo absente ou illisible : la miniature devient un emplacement
      // « Photo à venir », comme la grande photo qui pointe vers le même fichier.
      let image = item.querySelector("img");
      image.addEventListener("error", () => {
        image.closest("li").replaceWith(htmlToFragment(templateThumbnailPlaceholder));
      });

      return item;
    });
    fragment.querySelector('slot[name="thumbnails"]').replaceWith(...thumbnails);
    // Une seule photo : pas de miniatures, la liste n'est pas annoncée.
    fragment.querySelector("ul").hidden = thumbnails.length === 0;

    // Délégation : un seul écouteur sur la liste pour toutes les miniatures.
    fragment.querySelector("ul").addEventListener("click", (ev) => {
      let button = ev.target.closest("button[data-index]");
      if (button === null) return;
      actions.onSelect(Number(button.dataset.index));
    });

    return fragment;
  },

  /**
   * @param {string} name - Nom du produit, pour l'alternative textuelle.
   * @param {?string} url - Adresse de la photo, ou null.
   * @returns {DocumentFragment} La grande photo, ou son remplaçant.
   */
  main: function (name, url) {
    if (url === null) {
      return htmlToFragment(genericRenderer(templateMainPlaceholder, { name }));
    }

    let fragment = htmlToFragment(genericRenderer(templateMainImage, { name, url }));
    let image = fragment.querySelector("img");

    // Fichier absent ou illisible : remplaçant plutôt qu'une image cassée.
    image.addEventListener("error", () => {
      image.parentElement.replaceWith(ProductGalleryView.main(name, null));
    });

    return fragment;
  },
};

export { ProductGalleryView };
