import { genericRenderer, htmlToFragment } from "../../lib/utils.js";
import { formaterDuree, formaterNote, teinteDepuisTexte } from "../../lib/format.js";
import template from "./template.html?raw";

// Carte d'un film, tel que le renvoie l'API :
// { titre, realisateur, annee, duree_minutes, note_moyenne, genre }
let CarteFilmView = {
  html: function (film) {
    // Les valeurs sont mises en forme avant d'être passées au template.
    return genericRenderer(template, {
      titre: film.titre,
      realisateur: film.realisateur,
      genre: film.genre,
      annee: film.annee,
      note: formaterNote(film.note_moyenne),
      duree: formaterDuree(film.duree_minutes),
      teinte: teinteDepuisTexte(film.titre),
    });
  },

  dom: function (film) {
    return htmlToFragment(CarteFilmView.html(film));
  },
};

export { CarteFilmView };
