<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\ProductModel;

/**
 * Panier (US CMD-b).
 *
 * Le panier lui-même est gardé par le navigateur (localStorage) : il ne
 * contient que des identifiants de variantes et des quantités. Cette route
 * fournit, pour ces variantes, le nom, la photo, le PRIX et le stock tels
 * qu'ils sont en base : le navigateur ne fait jamais foi pour un prix.
 *
 * Le stock permet au panier de plafonner les quantités et de signaler les
 * articles épuisés (US STK-c).
 *
 * Les quantités, la disponibilité et les prix seront revérifiés à la
 * validation de la commande (CMD-a), dans une transaction.
 */
final class CartController
{
    /** Nombre maximal de variantes demandées en une fois. */
    private const MAX_VARIANTS = 50;

    /** Le modèle qui interroge la base, fourni à la construction. */
    private ProductModel $products;

    /**
     * @param ProductModel $products Accès aux produits et à leurs variantes.
     */
    public function __construct(ProductModel $products)
    {
        $this->products = $products;
    }

    /**
     * GET /api/cart?variants=12,4,31
     *
     * Répond { variants } : une entrée par variante encore visible au
     * catalogue, avec son stock. Une variante absente de la réponse n'est
     * plus disponible. 400 si la liste est vide, trop longue ou contient une valeur invalide.
     *
     * @param Request $request Requête entrante.
     */
    public function show(Request $request): void
    {
        $values = explode(',', $request->parametre('variants', ''));

        if (count($values) > self::MAX_VARIANTS) {
            Response::erreur('Trop d\'articles dans le panier', 400);
        }

        // filter_var refuse « 12abc », « -3 » ou « 0 », que (int) aurait acceptés.
        $ids = array_map(
            static fn (string $value): int|false => filter_var(
                trim($value),
                FILTER_VALIDATE_INT,
                ['options' => ['min_range' => 1]],
            ),
            $values,
        );

        if (in_array(false, $ids, true)) {
            Response::erreur('Identifiants de variantes invalides', 400);
        }

        // array_values : array_unique garde les clés d'origine, le modèle
        // attend une liste indexée à partir de 0.
        $ids = array_values(array_unique($ids));

        Response::json(['variants' => $this->products->findCartVariants($ids)]);
    }
}
