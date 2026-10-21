import { Router } from "./lib/router.js";
import { RootLayout } from "./layouts/root/layout.js";
import { CataloguePage } from "./pages/catalogue/page.js";
import { ProductPage } from "./pages/product/page.js";
import { CategoryPage } from "./pages/category/page.js";
import { CartPage } from "./pages/cart/page.js";
import { LoginPage } from "./pages/login/page.js";
import { CheckoutPage } from "./pages/checkout/page.js";
import { The404Page } from "./pages/404/page.js";

// base : chemin du projet sur le serveur (BASE dans vite.config.js).
const router = new Router("app", { base: import.meta.env.BASE_URL });

router.addLayout("/", RootLayout);

// DEC-b — Catalogue (écran Figma n° 1).
router.addRoute("/", CataloguePage);

// DEC-c — Détail produit (écran Figma n° 2). params.id dans la page.
router.addRoute("/produits/:id", ProductPage);

// DEC-a — Catégorie (écran Figma n° 3). params.slug dans la page.
router.addRoute("/categories/:slug", CategoryPage);

// CMD-b — Panier (écran Figma n° 4).
router.addRoute("/panier", CartPage);

// CMD-c — Authentification (écran Figma n° 5).
router.addRoute("/connexion", LoginPage);

// CMD-a — Validation de commande (écran Figma n° 6).
router.addRoute("/commande", CheckoutPage);

// En dernier : toute adresse qui ne correspond à aucune route.
router.addRoute("*", The404Page);

// Démarrer le routeur
router.start();
