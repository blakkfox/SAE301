<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\CategoryModel;
use App\Model\ProductModel;

/**
 * Liste des catégories (US DEC-a) : la colonne « Catégories » et les
 * sous-catégories de la page catégorie.
 *
 * Les produits d'une catégorie passent par GET /api/products?category=…
 * (CatalogueController) : pagination et tri y sont déjà gérés.
 */
final class CategoryController
{
    /** Accès aux catégories, fourni à la construction. */
    private CategoryModel $categories;

    /** Accès aux produits, pour le total « Tous les produits ». */
    private ProductModel $products;

    /**
     * @param CategoryModel $categories Accès aux catégories.
     * @param ProductModel  $products   Accès aux produits.
     */
    public function __construct(CategoryModel $categories, ProductModel $products)
    {
        $this->categories = $categories;
        $this->products   = $products;
    }

    /**
     * GET /api/categories
     *
     * Répond { categories, total } :
     * - categories : l'arbre des catégories, avec leur nombre de produits ;
     * - total : le nombre de produits visibles de tout le catalogue.
     *
     * @param Request $request Requête entrante (sans paramètre).
     */
    public function index(Request $request): void
    {
        Response::json([
            'categories' => $this->categories->findTree(),
            'total'      => $this->products->countVisible(),
        ]);
    }
}
