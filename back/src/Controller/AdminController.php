<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Response;
use App\Model\CategoryModel;
use App\Model\CustomerModel;
use App\Model\OrderModel;
use App\Model\ProductModel;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Back-office (US GOF-b) : tableau de bord de l'administration.
 *
 * Le rôle n'est jamais lu dans la requête ni dans un cookie : le compte
 * connecté (identifiant rangé en session par AuthController) est relu en
 * base, et seul un compte « admin » obtient une réponse.
 */
final class AdminController
{
    /** Fuseau des concessions : « aujourd'hui » est celui de Lyon (comme OrderController). */
    private const TIMEZONE = 'Europe/Paris';

    /** Seuil d'alerte de stock, comme LOW_STOCK_MAX dans front/src/lib/stock.js. */
    private const LOW_STOCK_MAX = 3;

    /** Nombre d'alertes de stock détaillées (les autres sont seulement comptées). */
    private const ALERT_LIMIT = 6;

    /** Nombre de « Prochaines commandes à préparer ». */
    private const UPCOMING_LIMIT = 5;

    /** Accès aux comptes. */
    private CustomerModel $customers;

    /** Accès aux produits et à leurs stocks. */
    private ProductModel $products;

    /** Accès aux catégories. */
    private CategoryModel $categories;

    /** Accès aux commandes. */
    private OrderModel $orders;

    /**
     * @param CustomerModel $customers  Accès aux comptes.
     * @param ProductModel  $products   Accès aux produits.
     * @param CategoryModel $categories Accès aux catégories.
     * @param OrderModel    $orders     Accès aux commandes.
     */
    public function __construct(
        CustomerModel $customers,
        ProductModel $products,
        CategoryModel $categories,
        OrderModel $orders,
    ) {
        $this->customers  = $customers;
        $this->products   = $products;
        $this->categories = $categories;
        $this->orders     = $orders;
    }

    /**
     * GET /api/admin/dashboard
     *
     * Répond { admin, stats, upcomingOrders, stockAlerts, stockAlertCount } :
     * - admin : prénom et nom du compte connecté ;
     * - stats : productCount, categoryCount (premier niveau), orderCount
     *   (depuis l'ouverture), inProgressCount, availableCount, soldOut
     *   (produits épuisés : id, name) ;
     * - upcomingOrders : commandes « en cours » ou « disponibles », par début
     *   de créneau, avec dayOffset (0 aujourd'hui, 1 demain, -1 hier…) ;
     * - stockAlerts : variantes dont le stock est au plus LOW_STOCK_MAX, les
     *   ALERT_LIMIT premières ; stockAlertCount : leur nombre total.
     *
     * 401 si personne n'est connecté, 403 si le compte n'est pas administrateur.
     */
    public function dashboard(): void
    {
        $admin = $this->requireAdmin();

        $statusCounts = $this->orders->countByStatus();
        $alerts       = $this->products->findLowStockVariants(self::LOW_STOCK_MAX);
        $today        = (new DateTimeImmutable('now', new DateTimeZone(self::TIMEZONE)))->setTime(0, 0);

        Response::json([
            'admin'           => ['firstName' => $admin['firstName'], 'lastName' => $admin['lastName']],
            'stats'           => [
                'productCount'    => $this->products->countVisible(),
                'categoryCount'   => count($this->categories->findTree()),
                'orderCount'      => array_sum($statusCounts),
                'inProgressCount' => $statusCounts['en_cours'],
                'availableCount'  => $statusCounts['disponible'],
                'soldOut'         => $this->products->findSoldOut(),
            ],
            'upcomingOrders'  => array_map(
                static fn (array $order): array => $order + ['dayOffset' => self::dayOffset($order['pickupStart'], $today)],
                $this->orders->findUpcoming(self::UPCOMING_LIMIT),
            ),
            'stockAlerts'     => array_slice($alerts, 0, self::ALERT_LIMIT),
            'stockAlertCount' => count($alerts),
        ]);
    }

    /**
     * Compte administrateur connecté, relu en base. Répond 401 (personne
     * n'est connecté) ou 403 (compte client), et s'arrête, sinon.
     *
     * @return array{id:int, firstName:string, lastName:string, email:string, phone:string, role:string}
     */
    private function requireAdmin(): array
    {
        $id      = $_SESSION['customerId'] ?? null;
        $account = is_int($id) ? $this->customers->findById($id) : null;

        if ($account === null) {
            Response::erreur('Connectez-vous pour accéder à l\'administration.', 401);
        }
        if ($account['role'] !== 'admin') {
            Response::erreur('Ce compte n\'a pas accès à l\'administration.', 403);
        }

        return $account;
    }

    /**
     * @param string            $datetime Début du créneau, « 2026-10-21 16:00:00 ».
     * @param DateTimeImmutable $today    Aujourd'hui à minuit, à l'heure de Lyon.
     *
     * @return int Nombre de jours entre aujourd'hui et le créneau : 0
     *             aujourd'hui, 1 demain, -1 hier.
     */
    private static function dayOffset(string $datetime, DateTimeImmutable $today): int
    {
        $day = new DateTimeImmutable(substr($datetime, 0, 10), $today->getTimezone());

        return (int) $today->diff($day)->format('%r%a');
    }
}
