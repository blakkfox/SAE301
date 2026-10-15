<?php

declare(strict_types=1);

namespace App\Core;

use RuntimeException;

/**
 * Associe une requête entrante au contrôleur chargé de la traiter.
 *
 * Les routes sont déclarées dans back/src/routes.php sous la forme :
 *     'GET /api/films' => [CatalogueController::class, 'index']
 */
final class Router
{
    /** Table des routes, telle que déclarée dans routes.php. */
    private array $routes;

    /** Instances de contrôleurs, indexées par nom de classe. */
    private array $controleurs;

    /**
     * @param array<string, array{0:string, 1:string}> $routes
     * @param array<string, object>                    $controleurs
     */
    public function __construct(array $routes, array $controleurs)
    {
        $this->routes      = $routes;
        $this->controleurs = $controleurs;
    }

    public function traiter(Request $requete): void
    {
        foreach ($this->routes as $declaration => $cible) {
            if (self::normaliser($declaration) !== $requete->signature()) {
                continue;
            }

            // $cible est le tableau déclaré dans routes.php :
            // à l'indice 0 le nom de la classe, à l'indice 1 celui de la méthode.
            $classe  = $cible[0];
            $methode = $cible[1];

            $controleur = $this->controleurs[$classe] ?? null;

            if ($controleur === null) {
                throw new RuntimeException(
                    "Le contrôleur {$classe} n'est pas enregistré dans back/index.php."
                );
            }

            // Le nom de la méthode est dans une variable, et PHP appelle la
            // méthode qui porte ce nom. Si $methode vaut 'index', la ligne
            // ci-dessous revient exactement à écrire $controleur->index($requete).
            // C'est ce qui permet à un routeur de fonctionner sans connaître à
            // l'avance les contrôleurs qu'il servira.
            $controleur->$methode($requete);
            return;
        }

        Response::erreur('Route inconnue : ' . $requete->signature(), 404);
    }

    /**
     * « GET   /api/films » et « GET /api/films » désignent la même route :
     * on réduit les espaces multiples pour permettre un alignement lisible
     * dans le fichier de déclaration.
     */
    private static function normaliser(string $declaration): string
    {
        return preg_replace('/\s+/', ' ', trim($declaration)) ?? $declaration;
    }
}
