<?php

declare(strict_types=1);

use App\Controller\AccountController;
use App\Controller\AdminController;
use App\Controller\AuthController;
use App\Controller\CartController;
use App\Controller\CatalogueController;
use App\Controller\CategoryController;
use App\Controller\OrderController;
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
    'GET  /api/promotion'  => [ProductController::class,   'promotion'],
    'GET  /api/categories' => [CategoryController::class,  'index'],
    'GET  /api/cart'       => [CartController::class,      'show'],
    'GET  /api/me'             => [AuthController::class,      'me'],
    'POST /api/login'          => [AuthController::class,      'login'],
    'POST /api/register'       => [AuthController::class,      'register'],
    'POST /api/password-reset' => [AuthController::class,      'resetPassword'],
    'POST /api/logout'         => [AuthController::class,      'logout'],
    'GET  /api/checkout'       => [OrderController::class,     'checkout'],
    'POST /api/orders'         => [OrderController::class,     'create'],
    'GET  /api/orders'         => [OrderController::class,     'history'],
    'GET  /api/order'          => [OrderController::class,     'show'],
    'GET  /api/account'          => [AccountController::class, 'show'],
    'POST /api/account'          => [AccountController::class, 'update'],
    'POST /api/account/password' => [AccountController::class, 'changePassword'],
    'POST /api/admin/login'    => [AuthController::class,      'adminLogin'],
    'GET  /api/admin/dashboard' => [AdminController::class,    'dashboard'],
    'GET  /api/admin/orders'         => [AdminController::class, 'orders'],
    'GET  /api/admin/order'          => [AdminController::class, 'order'],
    'POST /api/admin/orders/status'  => [AdminController::class, 'updateStatus'],
    'POST /api/admin/orders/cancel'  => [AdminController::class, 'cancelOrder'],
    'GET  /api/admin/categories'        => [AdminController::class, 'categories'],
    'POST /api/admin/categories'        => [AdminController::class, 'createCategory'],
    'POST /api/admin/categories/update' => [AdminController::class, 'updateCategory'],
    'POST /api/admin/categories/delete' => [AdminController::class, 'deleteCategory'],
    'GET  /api/admin/products'        => [AdminController::class, 'products'],
    'GET  /api/admin/product'         => [AdminController::class, 'product'],
    'POST /api/admin/products'        => [AdminController::class, 'createProduct'],
    'POST /api/admin/products/update' => [AdminController::class, 'updateProduct'],
    'POST /api/admin/products/delete' => [AdminController::class, 'deleteProduct'],
    'GET  /api/admin/stats'           => [AdminController::class, 'stats'],
    'GET  /api/admin/promo-codes'        => [AdminController::class, 'promoCodes'],
    'POST /api/admin/promo-codes'        => [AdminController::class, 'createPromoCode'],
    'POST /api/admin/promo-codes/update' => [AdminController::class, 'updatePromoCode'],
    'POST /api/admin/promo-codes/delete' => [AdminController::class, 'deletePromoCode'],
];
