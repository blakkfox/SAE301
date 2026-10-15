<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Response;
use App\Model\FilmModel;

/**
 * Statistiques du catalogue, réservées aux administrateurs.
 */
final class StatsController
{
    /** Le modèle qui interroge la base, fourni à la construction. */
    private FilmModel $films;

    public function __construct(FilmModel $films)
    {
        $this->films = $films;
    }

    public function index(): void
    {
        // La session est déjà ouverte par index.php.
        if (($_SESSION['role'] ?? '') !== 'admin') {
            Response::erreur('Accès réservé aux administrateurs', 403);
        }

        Response::json($this->films->statistiques());
    }
}
