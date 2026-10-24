<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\ProductModel;
use App\Model\PromoCodeModel;
use DateTimeImmutable;
use DateTimeZone;

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
 * Les options proposées pour chaque produit (US OPT-a), avec leur supplément
 * lu en base, permettent au panier d'afficher et de modifier les options
 * cochées de chaque ligne.
 *
 * Code promo (US PRO-a) : le client saisit un code au panier, et cette
 * classe dit s'il est utilisable aujourd'hui, avec sa réduction et son
 * montant minimum. Le panier calcule la remise sur ses prix (lus dans l'API) ;
 * la commande (OrderController) revérifie le code et recalcule la remise.
 *
 * Les quantités, la disponibilité et les prix seront revérifiés à la
 * validation de la commande (CMD-a), dans une transaction.
 */
final class CartController
{
    /** Nombre maximal de variantes demandées en une fois. */
    private const MAX_VARIANTS = 50;

    /** Longueur maximale d'un code promo (colonne promo_code.code). */
    private const PROMO_CODE_MAX = 20;

    /** Fuseau des concessions : un code est valable jusqu'à minuit, heure de Lyon. */
    private const TIMEZONE = 'Europe/Paris';

    /** Le modèle qui interroge la base, fourni à la construction. */
    private ProductModel $products;

    /** Accès aux codes promo. */
    private PromoCodeModel $promoCodes;

    /**
     * @param ProductModel   $products   Accès aux produits et à leurs variantes.
     * @param PromoCodeModel $promoCodes Accès aux codes promo.
     */
    public function __construct(ProductModel $products, PromoCodeModel $promoCodes)
    {
        $this->products   = $products;
        $this->promoCodes = $promoCodes;
    }

    /**
     * GET /api/cart?variants=12,4,31
     *
     * Répond { variants } : une entrée par variante encore visible au
     * catalogue, avec son stock et les options de son produit (options,
     * liste vide s'il n'en a pas). Une variante absente de la réponse n'est
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

        $variants = $this->products->findCartVariants($ids);
        $options  = $this->products->findOptionsByProducts(
            array_values(array_unique(array_column($variants, 'productId'))),
        );

        Response::json([
            'variants' => array_map(
                static fn (array $variant): array => $variant + ['options' => $options[$variant['productId']] ?? []],
                $variants,
            ),
        ]);
    }

    /**
     * GET /api/promo-code?code=BIENVENUE10
     *
     * Code promo saisi au panier (US PRO-a), en majuscules ou non. Répond
     * { promoCode: { code, discountRate, minAmount } } si le code est
     * utilisable aujourd'hui : discountRate en %, minAmount en euros (0 : sans
     * minimum), que le panier compare lui-même à son montant.
     *
     * 422 si le code est vide, ou s'il n'est pas actif (programmé, expiré ou
     * épuisé) ; 404 s'il n'existe pas. Le message (clé « erreur », et
     * « champs.promoCode ») est celui à afficher sous le champ.
     *
     * @param Request $request Requête entrante.
     */
    public function promoCode(Request $request): void
    {
        $code = self::normalizePromoCode($request->parametre('code', ''));

        if ($code === '') {
            self::refusePromoCode('Saisissez un code promo.', 422);
        }

        $promoCode = mb_strlen($code) > self::PROMO_CODE_MAX ? null : $this->promoCodes->findByCode($code);
        $refusal   = self::promoCodeRefusal($promoCode, $code);

        if ($refusal !== null) {
            self::refusePromoCode($refusal, $promoCode === null ? 404 : 422);
        }

        Response::json([
            'promoCode' => [
                'code'         => $promoCode['code'],
                'discountRate' => $promoCode['discountRate'],
                'minAmount'    => $promoCode['minAmount'],
            ],
        ]);
    }

    /**
     * Code promo tel qu'il est cherché en base : sans espaces autour, en
     * majuscules. Sert aussi à la commande (OrderController).
     *
     * @param mixed $code Valeur reçue.
     *
     * @return string Chaîne vide si rien d'exploitable n'a été reçu.
     */
    public static function normalizePromoCode(mixed $code): string
    {
        return is_string($code) ? mb_strtoupper(trim($code)) : '';
    }

    /**
     * Raison pour laquelle un code ne peut pas être utilisé aujourd'hui, à
     * l'heure de Lyon (statut calculé par AdminController::promoStatus). Sert
     * aussi à la commande (OrderController). Le montant minimum n'est pas
     * vérifié ici : il dépend du panier.
     *
     * @param array{code:string, startsOn:?string, endsOn:?string, maxUses:?int, useCount:int}|null $promoCode
     *        Code trouvé en base, ou null.
     * @param string $code Code saisi, normalisé (pour le message d'un code inconnu).
     *
     * @return string|null Message à afficher, ou null si le code est utilisable.
     */
    public static function promoCodeRefusal(?array $promoCode, string $code): ?string
    {
        if ($promoCode === null) {
            // Borné : la saisie est renvoyée telle quelle dans le message.
            return 'Le code ' . mb_substr($code, 0, self::PROMO_CODE_MAX) . ' n\'existe pas. Vérifiez votre saisie.';
        }

        $today = (new DateTimeImmutable('now', new DateTimeZone(self::TIMEZONE)))->format('Y-m-d');

        return match (AdminController::promoStatus($promoCode, $today)) {
            'programme' => 'Le code ' . $promoCode['code'] . ' n\'est valable qu\'à partir du ' . self::formatDate($promoCode['startsOn']) . '.',
            'expire'    => 'Le code ' . $promoCode['code'] . ' a expiré le ' . self::formatDate($promoCode['endsOn']) . '.',
            'epuise'    => 'Le code ' . $promoCode['code'] . ' a atteint son nombre maximal d\'utilisations.',
            default     => null,
        };
    }

    /**
     * Répond par le refus d'un code promo et s'arrête.
     *
     * @param string $message Message à afficher sous le champ.
     * @param int    $status  Code HTTP (404 ou 422).
     */
    private static function refusePromoCode(string $message, int $status): void
    {
        Response::json(['erreur' => $message, 'champs' => ['promoCode' => $message]], $status);
    }

    /**
     * @param string $date Date « 2026-11-01 ».
     *
     * @return string « 01/11/2026 », comme sur la maquette.
     */
    private static function formatDate(string $date): string
    {
        return substr($date, 8, 2) . '/' . substr($date, 5, 2) . '/' . substr($date, 0, 4);
    }
}
