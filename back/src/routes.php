<?php

declare(strict_types=1);

use App\Controller\AuthController;
use App\Controller\CatalogueController;

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
    'GET  /api/products' => [CatalogueController::class, 'index'],
    'POST /api/login'    => [AuthController::class,      'login'],
    'POST /api/logout'   => [AuthController::class,      'logout'],
];
