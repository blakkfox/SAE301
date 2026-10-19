<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\ProductModel;

/**
 * Fiche d'un produit (US DEC-c).
 *
 * Le routeur du starter compare des chemins exacts : l'identifiant passe donc
 * dans la chaîne de requête (/api/product?id=13) et non dans le chemin.
 */
final class ProductController
{
    /** Nombre de produits du bloc « Vous aimerez aussi ». */
    private const RELATED_COUNT = 4;

    /** Le modèle qui interroge la base, fourni à la construction. */
    private ProductModel $products;

    /**
     * @param ProductModel $products Accès aux produits.
     */
    public function __construct(ProductModel $products)
    {
        $this->products = $products;
    }

    /**
     * GET /api/product?id=13
     *
     * Répond { product, related } :
     * - product : le produit, sa catégorie, ses variantes et ses caractéristiques ;
     * - related : les cartes du bloc « Vous aimerez aussi ».
     * 400 si l'identifiant est invalide, 404 si le produit n'est pas visible.
     *
     * @param Request $request Requête entrante.
     */
    public function show(Request $request): void
    {
        // filter_var refuse « 12abc », « -3 » ou « 0 », que (int) aurait acceptés.
        $id = filter_var($request->parametre('id'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false) {
            Response::erreur('Identifiant de produit invalide', 400);
        }

        $product = $this->products->findVisibleById($id);

        if ($product === null) {
            Response::erreur('Produit introuvable', 404);
        }

        $product['variants'] = $this->products->findVariants($id);
        $product['features'] = $this->products->findFeatures($id);

        Response::json([
            'product' => $product,
            'related' => $this->products->findRelated($id, $product['category']['id'], self::RELATED_COUNT),
        ]);
    }
}
