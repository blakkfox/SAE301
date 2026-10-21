<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\CategoryModel;
use App\Model\ProductModel;

/**
 * Catalogue des produits (US DEC-b) : liste paginée et triée, éventuellement
 * limitée à une catégorie (US DEC-a).
 *
 * Le tri choisi est une préférence : il est mémorisé dans un cookie et
 * appliqué aux visites suivantes.
 */
final class CatalogueController
{
    /**
     * Liste blanche des tris autorisés.
     *
     * La clé vient du client, la valeur est écrite par nous. Le client ne
     * choisit donc jamais un nom de colonne : il choisit une entrée dans un
     * tableau que nous contrôlons entièrement. Un paramètre lié ne conviendrait
     * pas : il protège une VALEUR, jamais un IDENTIFIANT comme une colonne.
     */
    private const SORTS = [
        'price_asc'  => 'product.price ASC',
        'price_desc' => 'product.price DESC',
        'name_asc'   => 'product.name ASC',
        'newest'     => 'product.created_at DESC',
    ];

    /** Tri appliqué sans choix valide : celui de la maquette. */
    private const DEFAULT_SORT = 'price_asc';

    /** Nombre de produits par page : 4 rangées de 3, ou 3 rangées de 4. */
    private const PER_PAGE = 12;

    /** Le modèle qui interroge la base, fourni à la construction. */
    private ProductModel $products;

    /** Accès aux catégories, pour traduire le slug demandé en identifiant. */
    private CategoryModel $categories;

    /** Chemin du projet sur le serveur, celui des cookies (voir config.php). */
    private string $cookiePath;

    /**
     * @param ProductModel  $products   Accès aux produits.
     * @param CategoryModel $categories Accès aux catégories.
     * @param string        $cookiePath Chemin des cookies, identique à BASE côté front.
     */
    public function __construct(ProductModel $products, CategoryModel $categories, string $cookiePath)
    {
        $this->products   = $products;
        $this->categories = $categories;
        $this->cookiePath = $cookiePath;
    }

    /**
     * GET /api/products?page=2&sort=price_asc&category=collection-honda&inStock=1
     *
     * Répond { products, sort, page, pageCount, total, perPage }.
     * Le front n'a jamais besoin de lire le cookie (HttpOnly) : l'API lui
     * rappelle le tri effectivement appliqué.
     * category est facultatif : sans lui, tout le catalogue. Une catégorie
     * parente renvoie aussi les produits de ses sous-catégories.
     * inStock=1 masque les produits épuisés (US STK-b) : total et pagination
     * ne comptent alors que les produits en stock. Toute autre valeur est ignorée.
     * 404 si la catégorie demandée n'existe pas.
     *
     * @param Request $request Requête entrante.
     */
    public function index(Request $request): void
    {
        // Vérifiée avant le cookie de tri : une requête refusée ne doit rien
        // enregistrer.
        $categorySlug = $request->parametre('category');
        $categoryId   = null;

        if ($categorySlug !== null) {
            $categoryId = $this->categories->findIdBySlug($categorySlug);

            if ($categoryId === null) {
                Response::erreur('Catégorie introuvable', 404);
            }
        }

        $requestedSort = $request->parametre('sort');

        // Lecture : l'URL porte le choix du moment, le cookie le réglage retenu.
        $sort = $requestedSort ?? $_COOKIE['sort'] ?? self::DEFAULT_SORT;
        $sort = array_key_exists($sort, self::SORTS) ? $sort : self::DEFAULT_SORT;

        // Enregistrement : uniquement pour un choix explicite ET valide, pour ne
        // jamais mémoriser une valeur fabriquée par le client. Le cookie est
        // posé avant Response::json(), qui termine le script.
        if ($requestedSort !== null && $requestedSort === $sort) {
            setcookie('sort', $sort, $this->cookieOptions());
        }

        $inStockOnly = $request->parametre('inStock') === '1';

        $total     = $this->products->countVisible($categoryId, $inStockOnly);
        $pageCount = max(1, (int) ceil($total / self::PER_PAGE));

        // filter_var refuse « 2abc » ou « -1 », que (int) aurait acceptés.
        $page = filter_var($request->parametre('page', '1'), FILTER_VALIDATE_INT) ?: 1;
        $page = max(1, min($page, $pageCount));

        $products = $this->products->findVisiblePage(
            self::SORTS[$sort],
            self::PER_PAGE,
            ($page - 1) * self::PER_PAGE,
            $categoryId,
            $inStockOnly,
        );

        Response::json([
            'products'  => $products,
            'sort'      => $sort,
            'page'      => $page,
            'pageCount' => $pageCount,
            'perPage'   => self::PER_PAGE,
            'total'     => $total,
        ]);
    }

    /**
     * Options du cookie de préférence.
     *
     * @return array{expires:int, path:string, httponly:bool, secure:bool, samesite:string}
     */
    private function cookieOptions(): array
    {
        return [
            'expires'  => time() + 30 * 24 * 3600,
            'path'     => $this->cookiePath,
            'httponly' => true,
            'secure'   => true,
            'samesite' => 'Lax',
        ];
    }
}
