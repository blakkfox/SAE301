import { AuthData } from "../../data/auth.js";
import { StatsData } from "../../data/stats.js";
import { htmlToFragment } from "../../lib/utils.js";
import { FormulaireConnexionView } from "../../ui/formulaire-connexion/index.js";
import { MessageView } from "../../ui/message/index.js";
import { StatistiquesView } from "../../ui/statistiques/index.js";
import template from "./template.html?raw";

/**
 * Page « Administration ».
 *
 * La page ne protège rien : le formulaire et la zone de statistiques sont
 * toujours là. C'est le serveur qui décide de l'accès, et la page affiche sa
 * réponse : 200 avec les statistiques, 401 ou 403 sinon.
 */

let M = {
  login: "", // dernier identifiant saisi, pour pré-remplir le formulaire
  stats: null, // statistiques, si le serveur les a fournies
  message: null, // { type, texte }, ou null
};

let C = {};

/**
 * Demande les statistiques. Le résultat dépend de ce que décide le serveur.
 */
C.chargerStats = async function () {
  try {
    M.stats = await StatsData.fetch();
  } catch (erreur) {
    M.stats = null;

    let texte = erreur.message;
    if (erreur.statut === 401) texte = "Vous n'êtes pas connecté.";
    if (erreur.statut === 403) texte = "Accès réservé aux administrateurs.";

    M.message = { type: "erreur", texte };
  }
};

C.handler_connexion = async function (login, mdp) {
  M.login = login;

  try {
    await AuthData.login(login, mdp);
    M.message = { type: "succes", texte: `Connecté en tant que ${login}.` };
    // La requête suivante transporte le cookie de session reçu à l'instant.
    await C.chargerStats();
  } catch (erreur) {
    M.message = { type: "erreur", texte: erreur.message };
  }

  V.rafraichir();
};

C.handler_deconnexion = async function () {
  try {
    await AuthData.logout();
    M.message = null;
    // On redemande les statistiques : c'est la réponse du serveur, et non le
    // clic, qui dit si la déconnexion a réellement eu lieu.
    await C.chargerStats();
  } catch (erreur) {
    M.message = { type: "erreur", texte: erreur.message };
  }

  V.rafraichir();
};

C.init = async function () {
  M.message = null;
  await C.chargerStats();
  return V.init();
};

let V = {};

V.racine = null; // élément racine de la page affichée

V.init = function () {
  let fragment = V.createPageFragment();
  V.racine = fragment.firstElementChild;
  return fragment;
};

// Même principe que la page Catalogue : toute la page se reconstruit à partir
// du modèle. L'identifiant saisi survit parce qu'il est dans le modèle.
V.rafraichir = function () {
  let fragment = V.createPageFragment();
  let nouvelleRacine = fragment.firstElementChild;
  V.racine.replaceWith(fragment);
  V.racine = nouvelleRacine;
};

V.createPageFragment = function () {
  let pageFragment = htmlToFragment(template);

  pageFragment.querySelector('slot[name="connexion"]').replaceWith(
    FormulaireConnexionView.dom(
      { login: M.login },
      { surConnexion: C.handler_connexion, surDeconnexion: C.handler_deconnexion }
    )
  );

  pageFragment.querySelector('slot[name="message"]').replaceWith(MessageView.dom(M.message));

  let slotStats = pageFragment.querySelector('slot[name="statistiques"]');
  if (M.stats === null) {
    slotStats.remove();
  } else {
    slotStats.replaceWith(StatistiquesView.dom(M.stats));
  }

  return pageFragment;
};

export function AdminPage() {
  return C.init();
}
