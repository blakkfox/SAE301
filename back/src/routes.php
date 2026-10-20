<?php

declare(strict_types=1);

use App\Controller\AuthController;
use App\Controller\CartController;
use App\Controller\CatalogueController;
use App\Controller\CategoryController;
use App\Controller\ProductController;

/**
 * Table des routes de l'API.
 *
 * Clé    : méthode HTTP et chemin, séparés par un ou plusieurs espaces.
 * Valeur : [classe du contrôleur, méthode à appeler].
 *
 * Toute instance de contrôleur utilisée ici doit également être enregistrée
 * dans back/index.php.
 */

return [
    'GET  /api/products'   => [CatalogueController::class, 'index'],
    'GET  /api/product'    => [ProductController::class,   'show'],
    'GET  /api/categories' => [CategoryController::class,  'index'],
    'GET  /api/cart'       => [CartController::class,      'show'],
    'GET  /api/me'             => [AuthController::class,      'me'],
    'POST /api/login'          => [AuthController::class,      'login'],
    'POST /api/register'       => [AuthController::class,      'register'],
    'POST /api/password-reset' => [AuthController::class,      'resetPassword'],
    'POST /api/logout'         => [AuthController::class,      'logout'],
];
