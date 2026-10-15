/**
 * Routeur côté client : associe une adresse à une page, et change de page sans
 * recharger le navigateur. Il gère les paramètres d'URL (/films/:id), les
 * layouts et la page 404.
 *
 * Les liens internes portent l'attribut data-link et un chemin de route, sans
 * le chemin du projet sur le serveur :
 *
 *     <a href="/admin" data-link>Administration</a>
 *
 * Le routeur ajoute lui-même ce chemin (l'option base) aux adresses : c'est le
 * « basename » de react-router.
 */
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

    // Boutons Précédent / Suivant du navigateur.
    window.addEventListener("popstate", () => this.handleRoute());

    // Intercepter les clics sur les liens internes.
    document.addEventListener("click", (e) => {
      // closest : le clic peut viser un élément placé à l'intérieur du lien.
      const lien = e.target.closest("a[data-link]");
      if (lien === null) return;

      // Ctrl/Cmd + clic, clic molette… : on laisse le navigateur ouvrir un
      // nouvel onglet, comme pour un lien ordinaire.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      e.preventDefault();
      this.navigate(this.routePath(lien.pathname));
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
      if (path.startsWith(prefix) && prefix.length > longestMatch) {
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

  // Convertir un chemin en regex : /films/:id -> ^\/films\/([^\/]+)$
  pathToRegex(path) {
    if (path === "*") return /.*/;

    const pattern = path
      .replace(/\//g, "\\/")
      .replace(/:(\w+)/g, "([^\\/]+)")
      .replace(/\*/g, ".*");

    return new RegExp("^" + pattern + "$");
  }

  // Extraire les noms des paramètres : /films/:id -> ["id"]
  extractParams(path) {
    const params = [];
    for (const match of path.matchAll(/:(\w+)/g)) {
      params.push(match[1]);
    }
    return params;
  }

  // Extraire les valeurs des paramètres : /films/12 -> { id: "12" }
  getParams(route, path) {
    const matches = path.match(route.regex);
    if (!matches) return {};

    const params = {};
    route.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(matches[i + 1]);
    });
    return params;
  }

  // Chemin de route d'une adresse : /~login/Base/admin -> /admin
  routePath(pathname) {
    if (pathname === this.base) return "/";
    if (pathname.startsWith(this.base + "/")) return pathname.slice(this.base.length);
    return pathname;
  }

  // Adresse d'un chemin de route : /admin -> /~login/Base/admin
  url(path) {
    return this.base + path;
  }

  // Naviguer vers une route
  navigate(path) {
    window.history.pushState(null, "", this.url(path));
    this.handleRoute();
  }

  // Afficher la page qui correspond à l'adresse courante
  async handleRoute() {
    const navigation = ++this.navigation;
    const path = this.routePath(window.location.pathname);

    const route = this.routes.find((r) => r.regex.test(path));
    if (!route) return;

    // Le handler peut renvoyer le contenu directement, ou une promesse (page
    // qui charge des données) : await convient aux deux cas.
    const content = await route.handler(this.getParams(route, path));

    // Pendant le chargement, l'utilisateur a pu cliquer ailleurs : on
    // n'affiche que la page de la navigation la plus récente.
    if (navigation !== this.navigation) return;

    this.renderContent(content, route, path);
  }

  // Rendre le contenu dans le root, à travers un layout s'il y en a un
  renderContent(content, route, path) {
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
      const layout = layoutFn();
      layout.querySelector("slot:not([name])").replaceWith(page);
      page = layout;
    }

    this.root.replaceChildren(page);
    this.updateLinks(path);
    window.scrollTo(0, 0);
  }

  // Compléter les liens internes, comme le fait <Link> dans react-router :
  // l'adresse réelle (avec la base) pour ouvrir un lien dans un nouvel onglet,
  // et aria-current="page" sur les liens de la page affichée.
  updateLinks(path) {
    for (const lien of this.root.querySelectorAll("a[data-link]")) {
      const route = this.routePath(lien.pathname);
      lien.setAttribute("href", this.url(route));

      if (route === path) {
        lien.setAttribute("aria-current", "page");
      } else {
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
