/**
 * Bascule entre thème clair et thème sombre.
 *
 * Le thème initial est appliqué par le script placé dans index.html, avant le
 * premier affichage. Le choix est conservé en localStorage : le serveur n'en a
 * jamais besoin, contrairement aux préférences du catalogue, qui conditionnent
 * la requête SQL et voyagent donc dans des cookies.
 */
export function basculerTheme() {
  const sombre = document.documentElement.classList.toggle("theme-dark");

  try {
    localStorage.setItem("theme", sombre ? "sombre" : "clair");
  } catch (e) {
    // Stockage indisponible : le thème s'applique quand même, mais ne
    // survivra pas au rechargement.
  }
}
