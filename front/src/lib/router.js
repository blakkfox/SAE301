/**
 * Routeur côté client : associe une adresse à une page, et change de page sans
 * recharger le navigateur. Il gère les paramètres d'URL (/produits/:id), les
 * layouts et la page 404.
 *
 * Les liens internes portent l'attribut data-link et un chemin de route, sans
 * le chemin du projet sur le serveur :
 *
 *     <a href="/admin" data-link>Administration</a>
 *
 * Le routeur ajoute lui-même ce chemin (l'option base) aux adresses : c'est le
 * « basename » de react-router. Les liens ajoutés après l'affichage (menu
 * chargé ensuite, liste reconstruite…) sont complétés dès leur insertion.
 *
 * Après chaque changement de page, le titre de l'onglet reprend le <h1> de la
 * page, et le focus y est placé (sauf au premier affichage) : un lecteur
 * d'écran annonce la nouvelle page.
 *
 * Une page dont un formulaire est modifié sans être enregistré le signale
 * par l'attribut data-unsaved : le routeur demande alors confirmation avant
 * de la quitter, et le navigateur avant de recharger ou de fermer l'onglet.
 */

// Titre de l'onglet, après celui de la page (« Panier · Honda Moto Lyon Centre »).
const SITE_TITLE = "Honda Moto Lyon Centre";

// Question posée avant de quitter une page aux modifications non enregistrées.
const UNSAVED_MESSAGE = "Vos modifications ne sont pas enregistrées. Quitter quand même la page ?";

class Router {
  constructor(id, options = {}) {
    this.root = document.getElementById(id);
    this.routes = [];
    this.layouts = {};

    // Chemin du projet sans la barre finale : « /~login/Base/ » devient
    // « /~login/Base », et « / » devient « ».
    this.base = (options.base ?? "/").replace(/\/$/, "");

    // Numéro de la dernière navigation demandée (voir handleRoute).
    this.navigation = 0;

    // Chemin de route et adresse complète de la page affichée.
    this.path = null;
    this.currentUrl = window.location.href;

    // Boutons Précédent / Suivant du navigateur. L'adresse a déjà changé :
    // si l'utilisateur renonce à quitter la page, on la rétablit.
    window.addEventListener("popstate", () => {
      if (!this.confirmLeave()) {
        window.history.pushState(null, "", this.currentUrl);
        return;
      }
      this.handleRoute();
    });

    // Rechargement ou fermeture de l'onglet avec des modifications en cours.
    window.addEventListener("beforeunload", (e) => {
      if (this.hasUnsavedChanges()) e.preventDefault();
    });

    // Liens insérés après l'affichage de la page, ou dont le href change.
    new MutationObserver(() => {
      if (this.path !== null) this.updateLinks(this.path);
    }).observe(this.root, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

    // Intercepter les clics sur les liens internes.
    document.addEventListener("click", (e) => {
      // closest : le clic peut viser un élément placé à l'intérieur du lien.
      const lien = e.target.closest("a[data-link]");
      if (lien === null) return;

      // Ctrl/Cmd + clic, clic molette… : on laisse le navigateur ouvrir un
      // nouvel onglet, comme pour un lien ordinaire.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      e.preventDefault();
      this.navigate(this.routePath(lien.pathname) + lien.search + lien.hash);
    });
  }

  // Enregistrer un layout pour un segment de route
  addLayout(pathPrefix, layoutFn) {
    this.layouts[pathPrefix] = layoutFn;
    return this;
  }

  // Trouver le layout correspondant à un chemin : le préfixe le plus long
  findLayout(path) {
    let matchedLayout = null;
    let longestMatch = 0;

    for (const [prefix, layout] of Object.entries(this.layouts)) {
      if (path.toLowerCase().startsWith(prefix) && prefix.length > longestMatch) {
        matchedLayout = layout;
        longestMatch = prefix.length;
      }
    }

    return matchedLayout;
  }

  // Ajouter une route. La route « * » (page 404) se déclare en dernier.
  addRoute(path, handler, options = {}) {
    this.routes.push({
      path,
      regex: this.pathToRegex(path),
      keys: this.extractParams(path),
      handler,
      useLayout: options.useLayout !== false, // true par défaut
    });
    return this;
  }

  // Convertir un chemin en regex : /produits/:id -> ^\/produits\/([^\/]+)$
  // Sans distinction de casse : /PANIER affiche le panier (les paramètres,
  // eux, gardent leur casse).
  pathToRegex(path) {
    if (path === "*") return /.*/;

    const pattern = path
      .replace(/\//g, "\\/")
      .replace(/:(\w+)/g, "([^\\/]+)")
      .replace(/\*/g, ".*");

    return new RegExp("^" + pattern + "$", "i");
  }

  // Extraire les noms des paramètres : /produits/:id -> ["id"]
  extractParams(path) {
    const params = [];
    for (const match of path.matchAll(/:(\w+)/g)) {
      params.push(match[1]);
    }
    return params;
  }

  // Extraire les valeurs des paramètres : /produits/12 -> { id: "12" }
  getParams(route, path) {
    const matches = path.match(route.regex);
    if (!matches) return {};

    const params = {};
    for (let i = 0; i < route.keys.length; i++) {
      params[route.keys[i]] = decodeURIComponent(matches[i + 1]);
    }
    return params;
  }

  // Chemin de route d'une adresse : /~login/Base/admin -> /admin. La barre
  // finale est ignorée : /panier/ affiche la même page que /panier.
  routePath(pathname) {
    let path = pathname;
    if (pathname === this.base) path = "/";
    else if (pathname.startsWith(this.base + "/")) path = pathname.slice(this.base.length);
    return path.length > 1 ? path.replace(/\/+$/, "") : path;
  }

  // true si la page affichée a un formulaire modifié et non enregistré.
  hasUnsavedChanges() {
    return this.root.querySelector("[data-unsaved]") !== null;
  }

  // true si l'on peut quitter la page : rien à perdre, ou l'utilisateur le confirme.
  confirmLeave() {
    return !this.hasUnsavedChanges() || window.confirm(UNSAVED_MESSAGE);
  }

  // Adresse d'un chemin de route : /admin -> /~login/Base/admin
  url(path) {
    return this.base + path;
  }

  // Naviguer vers une route
  navigate(path) {
    if (!this.confirmLeave()) return;
    window.history.pushState(null, "", this.url(path));
    this.handleRoute();
  }

  // Afficher la page qui correspond à l'adresse courante
  async handleRoute() {
    const navigation = ++this.navigation;
    const path = this.routePath(window.location.pathname);

    const route = this.routes.find((r) => r.regex.test(path));
    if (!route) return;

    // Paramètres de la chaîne de requête (?page=2&sort=name_asc), puis ceux
    // du chemin (/produits/:id), qui l'emportent en cas de nom commun.
    const params = {
      ...Object.fromEntries(new URLSearchParams(window.location.search)),
      ...this.getParams(route, path),
    };

    // Le handler peut renvoyer le contenu directement, ou une promesse (page
    // qui charge des données) : await convient aux deux cas.
    const content = await route.handler(params);

    // Pendant le chargement, l'utilisateur a pu cliquer ailleurs : on
    // n'affiche que la page de la navigation la plus récente.
    if (navigation !== this.navigation) return;

    this.renderContent(content, route, path, params);
  }

  // Rendre le contenu dans le root, à travers un layout s'il y en a un. Le
  // layout reçoit les mêmes paramètres que la page (l'en-tête y lit la
  // recherche en cours, ?q=…).
  renderContent(content, route, path, params) {
    let page = content;

    // Une page peut renvoyer une chaîne HTML (page statique) : on la
    // convertit en fragment.
    if (!(page instanceof DocumentFragment)) {
      const template = document.createElement("template");
      template.innerHTML = page;
      page = template.content;
    }

    const layoutFn = route.useLayout ? this.findLayout(path) : null;

    if (layoutFn) {
      // Le layout renvoie un fragment dont le <slot> sans nom reçoit la page.
      const layout = layoutFn(params);
      layout.querySelector("slot:not([name])").replaceWith(page);
      page = layout;
    }

    const isFirstRender = this.path === null;
    this.path = path;
    this.currentUrl = window.location.href;
    this.root.replaceChildren(page);
    this.updateLinks(path);
    window.scrollTo(0, 0);
    this.announcePage(isFirstRender);
  }

  // Titre de l'onglet d'après le <h1> de la page, et focus sur ce titre après
  // une navigation (au premier affichage, le focus reste en haut du document).
  announcePage(isFirstRender) {
    const heading = this.root.querySelector("main h1") ?? this.root.querySelector("h1");
    if (heading === null) {
      document.title = SITE_TITLE;
      return;
    }

    const text = heading.textContent.replace(/\s+/g, " ").trim();
    document.title = text === "" ? SITE_TITLE : `${text} · ${SITE_TITLE}`;

    if (isFirstRender) return;
    if (!heading.hasAttribute("tabindex")) {
      heading.setAttribute("tabindex", "-1");
      heading.classList.add("outline-none");
    }
    heading.focus({ preventScroll: true });
  }

  // Compléter les liens internes, comme le fait <Link> dans react-router :
  // l'adresse réelle (avec la base) pour ouvrir un lien dans un nouvel onglet,
  // et aria-current="page" sur les liens de la page affichée. La chaîne de
  // requête et l'ancre du lien (?page=2, #avis) sont conservées.
  updateLinks(path) {
    for (const lien of this.root.querySelectorAll("a[data-link]")) {
      const route = this.routePath(lien.pathname);
      const href = this.url(route) + lien.search + lien.hash;

      // Seulement si le href change : l'observateur des liens (constructeur)
      // serait sinon redéclenché sans fin.
      if (lien.getAttribute("href") !== href) lien.setAttribute("href", href);

      if (route === path) {
        if (!lien.hasAttribute("aria-current")) lien.setAttribute("aria-current", "page");
      } else if (lien.hasAttribute("aria-current")) {
        lien.removeAttribute("aria-current");
      }
    }
  }

  // Démarrer le routeur
  start() {
    this.handleRoute();
  }
}

export { Router };
