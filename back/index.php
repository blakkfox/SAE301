<?php

declare(strict_types=1);

/**
 * Point d'entrée unique de l'API.
 *
 * Toutes les requêtes commençant par /api/ aboutissent ici, redirigées par le
 * fichier .htaccess situé à la racine du projet.
 *
 * Ce fichier ne contient aucune logique métier : il assemble les pièces et
 * confie la requête au routeur.
 */

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use App\Core\Router;
use App\Controller\AccountController;
use App\Controller\AdminController;
use App\Controller\AuthController;
use App\Controller\CartController;
use App\Controller\CatalogueController;
use App\Controller\CategoryController;
use App\Controller\OrderController;
use App\Controller\ProductController;
use App\Model\CategoryModel;
use App\Model\CustomerModel;
use App\Model\DealershipModel;
use App\Model\LoginAttemptModel;
use App\Model\OrderModel;
use App\Model\ProductModel;
use App\Model\PromoCodeModel;
use App\Model\StockModel;

// --- Chargement automatique des classes ------------------------------------
// App\Core\Router  ->  back/src/Core/Router.php
//
// Plutôt que d'écrire un require par classe, on confie à PHP la fonction
// ci-dessous. PHP la gardera de côté et l'appellera LUI-MÊME, chaque fois qu'il
// rencontrera un nom de classe qu'il ne connaît pas encore — en lui passant ce
// nom en paramètre. À charge pour elle de trouver le fichier correspondant et
// de l'inclure. Rien ici n'est exécuté maintenant : on prépare seulement ce qui
// servira plus tard.
spl_autoload_register(static function (string $classe): void {
    $prefixe = 'App\\';

    if (!str_starts_with($classe, $prefixe)) {
        return;
    }

    $relatif = substr($classe, strlen($prefixe));
    $fichier = __DIR__ . '/src/' . str_replace('\\', '/', $relatif) . '.php';

    if (is_file($fichier)) {
        require $fichier;
    }
});

$config = require __DIR__ . '/config/config.php';

// --- Affichage des erreurs --------------------------------------------------
// En développement, une erreur PHP brute casserait le JSON attendu par le front.
// On les capture pour toujours répondre un document exploitable.
error_reporting(E_ALL);
ini_set('display_errors', '0');

try {
    $pdo = Database::connexion($config['bdd']);

    // --- Assemblage ---------------------------------------------------------
    // Les dépendances sont créées explicitement : le modèle reçoit la connexion,
    // le contrôleur reçoit le modèle. Aucune magie, tout est lisible ici.
    $controleurs = [
        CatalogueController::class => new CatalogueController(new ProductModel($pdo, new StockModel($pdo)), new CategoryModel($pdo), $config['chemin']),
        ProductController::class   => new ProductController(new ProductModel($pdo, new StockModel($pdo))),
        CategoryController::class  => new CategoryController(new CategoryModel($pdo), new ProductModel($pdo, new StockModel($pdo))),
        CartController::class      => new CartController(new ProductModel($pdo, new StockModel($pdo)), new PromoCodeModel($pdo)),
        AuthController::class      => new AuthController(new CustomerModel($pdo), new LoginAttemptModel($pdo)),
        OrderController::class     => new OrderController(new CustomerModel($pdo), new DealershipModel($pdo), new OrderModel($pdo, new StockModel($pdo), new PromoCodeModel($pdo)), new PromoCodeModel($pdo)),
        AccountController::class   => new AccountController(new CustomerModel($pdo), new DealershipModel($pdo), new OrderModel($pdo, new StockModel($pdo), new PromoCodeModel($pdo))),
        AdminController::class     => new AdminController(new CustomerModel($pdo), new ProductModel($pdo, new StockModel($pdo)), new CategoryModel($pdo), new OrderModel($pdo, new StockModel($pdo), new PromoCodeModel($pdo)), new PromoCodeModel($pdo), __DIR__ . '/../front/public/images/produits'),
    ];

    $routes = require __DIR__ . '/src/routes.php';

    // --- Session : réglage unique, avant tout contrôleur --------------------
    // PHP n'envoie le cookie PHPSESSID qu'au moment où il crée la session : ses
    // paramètres doivent donc être fixés ici, avant session_start(), et nulle
    // part ailleurs.
    ini_set('session.use_strict_mode', '1');

    session_set_cookie_params([
        'path'     => $config['chemin'],
        'httponly' => true,
        'secure'   => true,
        'samesite' => 'Lax',
    ]);

    session_start();

    (new Router($routes, $controleurs))->traiter(Request::depuisGlobals());
} catch (Throwable $e) {
    Response::json(
        [
            'erreur' => $config['debug']
                ? $e->getMessage()
                : 'Une erreur interne est survenue.',
            'fichier' => $config['debug'] ? $e->getFile() . ':' . $e->getLine() : null,
        ],
        500,
    );
}
