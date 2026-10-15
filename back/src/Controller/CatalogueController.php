<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\FilmModel;

/**
 * Liste paginée et triée du catalogue.
 *
 * Le tri et le nombre de films par page sont des préférences : elles sont
 * mémorisées dans des cookies et appliquées aux visites suivantes.
 */
final class CatalogueController
{
    /**
     * Liste blanche des tris autorisés.
     *
     * La clé vient du client, la valeur est écrite par nous. Le client ne choisit
     * donc jamais un nom de colonne : il choisit une entrée dans un tableau que
     * nous contrôlons entièrement.
     *
     * Un paramètre lié ne conviendrait pas : il protège une VALEUR, jamais un
     * IDENTIFIANT. « ORDER BY :colonne » lié à 'titre' produit « ORDER BY
     * 'titre' », une chaîne constante : le tri ne trie plus rien, sans erreur.
     */
    private const TRIS = [
        'titre' => 'film.titre ASC',
        'annee' => 'film.annee DESC',
        'note'  => 'film.note_moyenne DESC',
    ];

    private const PAR_PAGE_AUTORISES = [12, 24, 48];

    /** Le modèle qui interroge la base, fourni à la construction. */
    private FilmModel $films;

    /** Chemin du projet sur le serveur, celui des cookies (voir config.php). */
    private string $chemin;

    public function __construct(FilmModel $films, string $chemin)
    {
        $this->films  = $films;
        $this->chemin = $chemin;
    }

    /**
     * Options partagées par les cookies de préférences.
     */
    private function optionsCookie(): array
    {
        return [
            'expires'  => time() + 30 * 24 * 3600,
            'path'     => $this->chemin,
            'httponly' => true,
            'secure'   => true,
            'samesite' => 'Lax',
        ];
    }

    public function index(Request $requete): void
    {
        // Enregistrement : uniquement quand l'utilisateur vient de choisir
        // (le front l'a alors placé dans l'URL).
        if ($requete->parametre('tri') !== null) {
            setcookie('tri',      $requete->parametre('tri'),     $this->optionsCookie());
            setcookie('par_page', $requete->parametre('parPage'), $this->optionsCookie());
        }

        // Lecture : l'URL porte le choix du moment, le cookie le réglage retenu.
        // L'URL passe en premier : un cookie posé par setcookie() ne figure
        // dans $_COOKIE qu'à la requête suivante.
        $tri     = $requete->parametre('tri') ?? $_COOKIE['tri'] ?? 'titre';
        $parPage = (int) ($requete->parametre('parPage') ?? $_COOKIE['par_page'] ?? 12);

        // Validation : on n'accepte que ce qui figure dans nos listes.
        $tri     = array_key_exists($tri, self::TRIS) ? $tri : 'titre';
        $parPage = in_array($parPage, self::PAR_PAGE_AUTORISES, true) ? $parPage : 12;
        $ordre   = self::TRIS[$tri];

        $total       = $this->films->compter();
        $pagesTotal  = max(1, (int) ceil($total / $parPage));
        $page        = (int) ($requete->parametre('page', '1') ?? '1');
        $page        = max(1, min($page, $pagesTotal));

        $films = $this->films->lister($ordre, $parPage, ($page - 1) * $parPage);

        Response::json([
            'films' => $films,
            // Le front n'a pas besoin de lire les cookies : l'API lui rappelle
            // les réglages effectivement appliqués.
            'tri'        => $tri,
            'parPage'    => $parPage,
            'page'       => $page,
            'pagesTotal' => $pagesTotal,
            'total'      => $total,
        ]);
    }
}
