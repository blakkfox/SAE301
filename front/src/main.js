import { Router } from "./lib/router.js";
import { RootLayout } from "./layouts/root/layout.js";
import { AdminLayout } from "./layouts/admin/layout.js";
import { CataloguePage } from "./pages/catalogue/page.js";
import { ProductPage } from "./pages/product/page.js";
import { CategoryPage } from "./pages/category/page.js";
import { CartPage } from "./pages/cart/page.js";
import { LoginPage } from "./pages/login/page.js";
import { CheckoutPage } from "./pages/checkout/page.js";
import { AccountPage } from "./pages/account/page.js";
import { AccountOrdersPage } from "./pages/account-orders/page.js";
import { AccountOrderPage } from "./pages/account-order/page.js";
import { AdminPage } from "./pages/admin/page.js";
import { AdminOrdersPage } from "./pages/admin-orders/page.js";
import { AdminCategoriesPage } from "./pages/admin-categories/page.js";
import { AdminProductsPage } from "./pages/admin-products/page.js";
import { AdminProductPage } from "./pages/admin-product/page.js";
import { The404Page } from "./pages/404/page.js";

// base : chemin du projet sur le serveur (BASE dans vite.config.js).
const router = new Router("app", { base: import.meta.env.BASE_URL });

router.addLayout("/", RootLayout);

// Administration : menu latéral noir au lieu de l'en-tête du site (GOF-b).
router.addLayout("/admin", AdminLayout);

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

// SUI-b — Espace personnel (écran Figma n° 14).
router.addRoute("/compte", AccountPage);

// SUI-c — Historique des commandes (écran Figma n° 13).
router.addRoute("/compte/commandes", AccountOrdersPage);

// SUI-a — Commander à nouveau (écran Figma n° 15). params.id dans la page.
router.addRoute("/compte/commandes/:id", AccountOrderPage);

// GOF-b — Back-office, tableau de bord (écran Figma n° 10).
router.addRoute("/admin", AdminPage);

// PIL-b — Gestion des commandes (écran Figma n° 11).
router.addRoute("/admin/commandes", AdminOrdersPage);

// GOF-c — Gestion des catégories (écran Figma n° 12).
router.addRoute("/admin/categories", AdminCategoriesPage);

// GOF-a — Gestion des produits : liste (non maquettée), puis fiche (écran
// Figma n° 19). params.id dans la page : un identifiant, ou « nouveau ».
router.addRoute("/admin/produits", AdminProductsPage);
router.addRoute("/admin/produits/:id", AdminProductPage);

// En dernier : toute adresse qui ne correspond à aucune route.
router.addRoute("*", The404Page);

// Démarrer le routeur
router.start();
