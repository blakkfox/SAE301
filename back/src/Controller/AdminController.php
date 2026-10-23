<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\CategoryModel;
use App\Model\CustomerModel;
use App\Model\OrderModel;
use App\Model\ProductModel;
use App\Model\PromoCodeModel;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Back-office : tableau de bord (US GOF-b), gestion des commandes (US PIL-b),
 * des catégories (US GOF-c), des produits (US GOF-a) et des codes promo
 * (US PRO-b), statistiques (US PIL-a).
 *
 * Le rôle n'est jamais lu dans la requête ni dans un cookie : le compte
 * connecté (identifiant rangé en session par AuthController) est relu en
 * base, et seul un compte « admin » obtient une réponse.
 */
final class AdminController
{
    /** Fuseau des concessions : « aujourd'hui » est celui de Lyon (comme OrderController). */
    private const TIMEZONE = 'Europe/Paris';

    /** Nombre d'alertes de stock détaillées (les autres sont seulement comptées). */
    private const ALERT_LIMIT = 6;

    /** Nombre de « Prochaines commandes à préparer ». */
    private const UPCOMING_LIMIT = 5;

    /**
     * Tris de la liste des commandes (US PIL-b) : le client choisit une clé,
     * jamais un fragment SQL (même liste blanche que CatalogueController).
     * Le statut suit l'ordre de l'ENUM : en cours, disponible, retirée, annulée.
     */
    private const ORDER_SORTS = [
        'pickup_desc'   => 'customer_order.pickup_start DESC',
        'pickup_asc'    => 'customer_order.pickup_start ASC',
        'customer_asc'  => 'customer.last_name ASC, customer.first_name ASC',
        'customer_desc' => 'customer.last_name DESC, customer.first_name DESC',
        'total_desc'    => 'customer_order.total DESC',
        'total_asc'     => 'customer_order.total ASC',
        'status_asc'    => 'customer_order.status ASC',
        'status_desc'   => 'customer_order.status DESC',
    ];

    /** Tri de la maquette : « Retrait ↓ ». */
    private const DEFAULT_ORDER_SORT = 'pickup_desc';

    /** Statuts d'une commande (colonne customer_order.status). */
    private const STATUSES = ['en_cours', 'disponible', 'retiree', 'annulee'];

    /** Commandes par page de la liste. */
    private const ORDERS_PER_PAGE = 20;

    /** Longueur maximale de la recherche « N° ou client ». */
    private const SEARCH_MAX_LENGTH = 60;

    /**
     * Passages de statut faits au back-office : nouveau statut => statut
     * requis. Le cycle est strict (en cours → disponible → retirée) ;
     * l'annulation a sa propre route, qui recrédite le stock.
     */
    private const TRANSITIONS = ['disponible' => 'en_cours', 'retiree' => 'disponible'];

    /** Nombre maximal de commandes changées en une fois. */
    private const BULK_MAX = 100;

    /** Longueur maximale du nom d'une catégorie (colonne category.name). */
    private const CATEGORY_NAME_MAX = 60;

    /** Longueur maximale de la description d'une catégorie (colonne category.description). */
    private const CATEGORY_DESCRIPTION_MAX = 160;

    /** Longueur maximale du nom d'un produit (colonne product.name). */
    private const PRODUCT_NAME_MAX = 120;

    /** Longueur maximale de la description d'un produit. */
    private const PRODUCT_DESCRIPTION_MAX = 2000;

    /** Longueur maximale du type de variante (colonne product.variant_axis). */
    private const VARIANT_AXIS_MAX = 20;

    /** Seuil « Bientôt épuisé » maximal (contrainte chk_product_threshold). */
    private const THRESHOLD_MAX = 99;

    /** Nombre maximal de variantes d'un produit. */
    private const VARIANTS_MAX = 30;

    /** Longueur maximale du libellé d'une variante (colonne variant.label). */
    private const VARIANT_LABEL_MAX = 60;

    /** Longueur maximale d'une référence (colonne variant.reference). */
    private const REFERENCE_MAX = 40;

    /** Stock maximal saisi pour une variante. */
    private const STOCK_MAX = 9999;

    /** Nombre maximal d'options d'un produit. */
    private const OPTIONS_MAX = 10;

    /** Nombre maximal de photos d'un produit : les emplacements de la galerie de la fiche. */
    private const IMAGES_MAX = 4;

    /** Longueur maximale du libellé d'une option (colonne product_option.label). */
    private const OPTION_LABEL_MAX = 60;

    /** Longueur maximale de la description d'une option (colonne product_option.description). */
    private const OPTION_DESCRIPTION_MAX = 120;

    /**
     * Périodes des statistiques (US PIL-a) : clé reçue => nombre de jours,
     * aujourd'hui compris, ou null pour « cette année » (depuis le 1er janvier).
     */
    private const STATS_PERIODS = ['7' => 7, '30' => 30, 'year' => null];

    /** Période de la maquette : « 30 jours ». */
    private const DEFAULT_STATS_PERIOD = '30';

    /** Jours du graphique « Revenus des 7 derniers jours », aujourd'hui compris. */
    private const CHART_DAYS = 7;

    /** Jour de fermeture des concessions, au format de date('N') : 7 = dimanche (comme OrderController). */
    private const CLOSED_DAY = 7;

    /** Nombre de « Produits les plus vendus ». */
    private const BEST_SELLER_LIMIT = 5;

    /** Nombre de mouvements de stock affichés sur la fiche. */
    private const MOVEMENT_LIMIT = 8;

    /** Nom de fichier accepté comme photo produit : pas de chemin, extension d'image. */
    private const IMAGE_PATTERN = '/^[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp)$/i';

    /** Code promo : lettres sans accent et chiffres, de 3 à 20 caractères (colonne promo_code.code). */
    private const PROMO_CODE_PATTERN = '/^[A-Z0-9]{3,20}$/';

    /** Réduction d'un code promo, en pourcentage. */
    private const PROMO_RATE_MIN = 1;
    private const PROMO_RATE_MAX = 90;

    /** Nombre maximal d'utilisations d'un code promo (colonne SMALLINT). */
    private const PROMO_USES_MAX = 9999;

    /** Lettres accentuées et ligatures, pour calculer un slug sans l'extension intl. */
    private const SLUG_LETTERS = [
        'à' => 'a', 'â' => 'a', 'ä' => 'a', 'ç' => 'c', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
        'î' => 'i', 'ï' => 'i', 'ô' => 'o', 'ö' => 'o', 'ù' => 'u', 'û' => 'u', 'ü' => 'u', 'ÿ' => 'y',
        'æ' => 'ae', 'œ' => 'oe',
    ];

    /** Accès aux comptes. */
    private CustomerModel $customers;

    /** Accès aux produits et à leurs stocks. */
    private ProductModel $products;

    /** Accès aux catégories. */
    private CategoryModel $categories;

    /** Accès aux commandes. */
    private OrderModel $orders;

    /** Accès aux codes promo. */
    private PromoCodeModel $promoCodes;

    /** Dossier des photos produit sur le serveur (US GOF-a). */
    private string $imageDir;

    /**
     * @param CustomerModel $customers  Accès aux comptes.
     * @param ProductModel  $products   Accès aux produits.
     * @param CategoryModel $categories Accès aux catégories.
     * @param OrderModel     $orders     Accès aux commandes.
     * @param PromoCodeModel $promoCodes Accès aux codes promo.
     * @param string         $imageDir   Dossier des photos produit, front/dist/images/produits.
     */
    public function __construct(
        CustomerModel $customers,
        ProductModel $products,
        CategoryModel $categories,
        OrderModel $orders,
        PromoCodeModel $promoCodes,
        string $imageDir,
    ) {
        $this->customers  = $customers;
        $this->products   = $products;
        $this->categories = $categories;
        $this->orders     = $orders;
        $this->promoCodes = $promoCodes;
        $this->imageDir   = $imageDir;
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
     * - stockAlerts : variantes dont le stock est au plus le seuil « Bientôt
     *   épuisé » de leur produit (lowStockThreshold, US GOF-a), les
     *   ALERT_LIMIT premières ; stockAlertCount : leur nombre total.
     *
     * 401 si personne n'est connecté, 403 si le compte n'est pas administrateur.
     */
    public function dashboard(): void
    {
        $admin = $this->requireAdmin();

        $statusCounts = $this->orders->countByStatus();
        $alerts       = $this->products->findLowStockVariants();
        $today        = self::today();

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
     * GET /api/admin/stats?period=30
     *
     * Répond { admin, period, stats, dailyRevenue, bestSellers, stock,
     * stockAlerts, stockAlertCount } (US PIL-a) :
     * - period : la période appliquée (« 7 », « 30 » ou « year »), une
     *   valeur invalide étant remplacée par DEFAULT_STATS_PERIOD ;
     * - stats : revenue et orderCount sur la période, previousRevenue et
     *   previousOrderCount sur la période précédente de même durée (l'an
     *   dernier à la même date pour « year »), inProgressCount,
     *   availableCount (en ce moment) et cancelledCount (depuis l'ouverture) ;
     * - dailyRevenue : les CHART_DAYS derniers jours, du plus ancien à
     *   aujourd'hui (date, revenue, isClosed : jour de fermeture) ;
     * - bestSellers : les BEST_SELLER_LIMIT produits les plus vendus sur la
     *   période (name, quantity) ;
     * - stock : les produits en ligne (id, name, stock total,
     *   lowStockThreshold), du mieux fourni au moins fourni ;
     * - stockAlerts, stockAlertCount : comme le tableau de bord.
     *
     * Revenus : commandes retirées, comptées le jour du retrait (paiement sur
     * place, voir OrderModel::findDailyRevenue). Commandes : passées sur la
     * période, annulées exclues.
     *
     * 401 si personne n'est connecté, 403 si le compte n'est pas administrateur.
     *
     * @param Request $request Requête entrante.
     */
    public function stats(Request $request): void
    {
        $admin = $this->requireAdmin();

        $period = $request->parametre('period', self::DEFAULT_STATS_PERIOD);
        $period = array_key_exists($period, self::STATS_PERIODS) ? $period : self::DEFAULT_STATS_PERIOD;

        $today    = self::today();
        $tomorrow = $today->modify('+1 day');
        $range    = self::statsRange(self::STATS_PERIODS[$period], $today);

        $statusCounts = $this->orders->countByStatus();
        $alerts       = $this->products->findLowStockVariants();

        $stock = array_values(array_filter(
            $this->products->findAdminList(),
            static fn (array $product): bool => $product['isActive'],
        ));
        usort($stock, static fn (array $a, array $b): int => $b['stock'] <=> $a['stock'] ?: strcmp($a['name'], $b['name']));

        Response::json([
            'admin'           => ['firstName' => $admin['firstName'], 'lastName' => $admin['lastName']],
            'period'          => $period,
            'stats'           => [
                'revenue'            => array_sum($this->orders->findDailyRevenue($range['from'], $tomorrow)),
                'previousRevenue'    => array_sum($this->orders->findDailyRevenue($range['previousFrom'], $range['previousTo'])),
                'orderCount'         => $this->orders->countPlaced($range['from'], $tomorrow),
                'previousOrderCount' => $this->orders->countPlaced($range['previousFrom'], $range['previousTo']),
                'inProgressCount'    => $statusCounts['en_cours'],
                'availableCount'     => $statusCounts['disponible'],
                'cancelledCount'     => $statusCounts['annulee'],
            ],
            'dailyRevenue'    => $this->dailyRevenue($today),
            'bestSellers'     => $this->orders->findBestSellers($range['from'], $tomorrow, self::BEST_SELLER_LIMIT),
            'stock'           => array_map(
                static fn (array $product): array => [
                    'id'                => $product['id'],
                    'name'              => $product['name'],
                    'stock'             => $product['stock'],
                    'lowStockThreshold' => $product['lowStockThreshold'],
                ],
                $stock,
            ),
            'stockAlerts'     => array_slice($alerts, 0, self::ALERT_LIMIT),
            'stockAlertCount' => count($alerts),
        ]);
    }

    /**
     * Revenus des CHART_DAYS derniers jours, un jour sans retrait valant 0.
     *
     * @param DateTimeImmutable $today Aujourd'hui à minuit, à l'heure de Lyon.
     *
     * @return array<int, array{date:string, revenue:float, isClosed:bool}>
     *         Du plus ancien à aujourd'hui.
     */
    private function dailyRevenue(DateTimeImmutable $today): array
    {
        $from    = $today->modify('-' . (self::CHART_DAYS - 1) . ' days');
        $revenue = $this->orders->findDailyRevenue($from, $today->modify('+1 day'));
        $days    = [];

        for ($i = 0; $i < self::CHART_DAYS; $i++) {
            $day    = $from->modify("+{$i} days");
            $date   = $day->format('Y-m-d');
            $days[] = [
                'date'     => $date,
                'revenue'  => $revenue[$date] ?? 0.0,
                'isClosed' => (int) $day->format('N') === self::CLOSED_DAY,
            ];
        }

        return $days;
    }

    /**
     * Bornes d'une période des statistiques et de la période précédente, à
     * laquelle elle est comparée. La période se termine demain à minuit
     * (aujourd'hui compris).
     *
     * @param int|null          $days  Nombre de jours (STATS_PERIODS), ou null pour l'année en cours.
     * @param DateTimeImmutable $today Aujourd'hui à minuit, à l'heure de Lyon.
     *
     * @return array{from:DateTimeImmutable, previousFrom:DateTimeImmutable, previousTo:DateTimeImmutable}
     *         Débuts inclus, fin exclue.
     */
    private static function statsRange(?int $days, DateTimeImmutable $today): array
    {
        if ($days === null) {
            $from = $today->setDate((int) $today->format('Y'), 1, 1);

            return [
                'from'         => $from,
                'previousFrom' => $from->modify('-1 year'),
                'previousTo'   => $today->modify('+1 day')->modify('-1 year'),
            ];
        }

        $from = $today->modify('-' . ($days - 1) . ' days');

        return [
            'from'         => $from,
            'previousFrom' => $from->modify("-{$days} days"),
            'previousTo'   => $from,
        ];
    }

    /**
     * GET /api/admin/orders?status=en_cours&q=dupont&sort=total_desc&page=2
     *
     * Répond { admin, counts, orders, status, search, sort, page, pageCount,
     * perPage, total } :
     * - counts : nombre de commandes de chaque statut, et « all » pour
     *   toutes, qui tiennent compte de la recherche (pastilles de filtre) ;
     * - orders : une page de ORDERS_PER_PAGE commandes, avec dayOffset
     *   (0 aujourd'hui, 1 demain, -1 hier…) ;
     * - status, search, sort, page : les réglages appliqués, une valeur
     *   invalide étant remplacée par celle par défaut (tous les statuts, sans
     *   recherche, DEFAULT_ORDER_SORT, page 1).
     *
     * 401 si personne n'est connecté, 403 si le compte n'est pas administrateur.
     *
     * @param Request $request Requête entrante.
     */
    public function orders(Request $request): void
    {
        $admin = $this->requireAdmin();

        $status = $request->parametre('status');
        $status = in_array($status, self::STATUSES, true) ? $status : null;

        $search = self::normalizeSearch($request->parametre('q'));

        $sort = $request->parametre('sort', self::DEFAULT_ORDER_SORT);
        $sort = array_key_exists($sort, self::ORDER_SORTS) ? $sort : self::DEFAULT_ORDER_SORT;

        $counts    = $this->orders->countByStatus($search);
        $total     = $status === null ? array_sum($counts) : $counts[$status];
        $pageCount = max(1, (int) ceil($total / self::ORDERS_PER_PAGE));

        // filter_var refuse « 2abc » ou « -1 », que (int) aurait acceptés.
        $page = filter_var($request->parametre('page', '1'), FILTER_VALIDATE_INT) ?: 1;
        $page = max(1, min($page, $pageCount));

        $orders = $this->orders->findAdminPage(
            self::ORDER_SORTS[$sort],
            self::ORDERS_PER_PAGE,
            ($page - 1) * self::ORDERS_PER_PAGE,
            $status,
            $search,
        );
        $today = self::today();

        Response::json([
            'admin'     => ['firstName' => $admin['firstName'], 'lastName' => $admin['lastName']],
            'counts'    => ['all' => array_sum($counts)] + $counts,
            'orders'    => array_map(
                static fn (array $order): array => $order + ['dayOffset' => self::dayOffset($order['pickupStart'], $today)],
                $orders,
            ),
            'status'    => $status,
            'search'    => $search ?? '',
            'sort'      => $sort,
            'page'      => $page,
            'pageCount' => $pageCount,
            'perPage'   => self::ORDERS_PER_PAGE,
            'total'     => $total,
        ]);
    }

    /**
     * GET /api/admin/order?id=142
     *
     * Répond { order } : la commande, sa concession, ses lignes, son client
     * (firstName, lastName, phone), le journal de ses statuts (events) et
     * dayOffset (jour du créneau par rapport à aujourd'hui).
     *
     * 400 si id est invalide, 404 si la commande n'existe pas ; 401, 403
     * comme orders().
     *
     * @param Request $request Requête entrante.
     */
    public function order(Request $request): void
    {
        $this->requireAdmin();

        $id = filter_var($request->parametre('id'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false) {
            Response::erreur('Identifiant de commande invalide', 400);
        }

        Response::json(['order' => $this->findDetailOrFail($id)]);
    }

    /**
     * POST /api/admin/orders/status, corps JSON
     * { ids: [142, 141], status: "disponible" | "retiree" }.
     *
     * Fait passer les commandes au statut demandé, si leur statut actuel le
     * permet (TRANSITIONS) : les autres sont laissées telles quelles.
     * Répond { status, updated, skipped } : les identifiants des commandes
     * changées, et ceux des commandes laissées.
     *
     * 400 si ids ou status est invalide ; 401, 403 comme orders().
     *
     * @param Request $request Requête entrante.
     */
    public function updateStatus(Request $request): void
    {
        $admin = $this->requireAdmin();
        $body  = $request->corps();

        $status = $body['status'] ?? null;
        $ids    = self::validateIds($body['ids'] ?? null);

        if (!is_string($status) || !array_key_exists($status, self::TRANSITIONS)) {
            Response::erreur('Statut demandé invalide', 400);
        }
        if ($ids === null) {
            Response::erreur('Commandes sélectionnées invalides', 400);
        }

        $updated = $this->orders->advanceStatus($ids, self::TRANSITIONS[$status], $status, $admin['id']);

        Response::json([
            'status'  => $status,
            'updated' => $updated,
            'skipped' => array_values(array_diff($ids, $updated)),
        ]);
    }

    /**
     * POST /api/admin/orders/cancel, corps JSON { id: 142 }.
     *
     * Annule la commande et recrédite le stock de ses articles (STK-a).
     * Répond { order } : la commande annulée, comme order().
     *
     * 400 si id est invalide, 404 si la commande n'existe pas, 409 si elle
     * est retirée ou déjà annulée ; 401, 403 comme orders().
     *
     * @param Request $request Requête entrante.
     */
    public function cancelOrder(Request $request): void
    {
        $admin = $this->requireAdmin();

        $id = filter_var($request->corps()['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false) {
            Response::erreur('Identifiant de commande invalide', 400);
        }

        $order = $this->findDetailOrFail($id);

        if (!$this->orders->cancel($id, $admin['id'])) {
            Response::erreur(
                $order['status'] === 'retiree'
                    ? 'Une commande retirée ne peut plus être annulée.'
                    : 'Cette commande est déjà annulée.',
                409,
            );
        }

        Response::json(['order' => $this->findDetailOrFail($id)]);
    }

    /**
     * GET /api/admin/categories
     *
     * Répond { admin, categories } : toutes les catégories, masquées
     * comprises, en arbre (children), avec isVisible et productCount (tous
     * les produits, sous-catégories comprises).
     *
     * 401 si personne n'est connecté, 403 si le compte n'est pas administrateur.
     */
    public function categories(): void
    {
        $admin = $this->requireAdmin();

        Response::json([
            'admin'      => ['firstName' => $admin['firstName'], 'lastName' => $admin['lastName']],
            'categories' => $this->categories->findAdminTree(),
        ]);
    }

    /**
     * POST /api/admin/categories, corps JSON
     * { name, description, isVisible, parentId }.
     *
     * Crée la catégorie (slug calculé depuis le nom) et répond { category },
     * en 201. 422 (clé « champs ») si la saisie est invalide ; 409 (clé
     * « champs ») si une catégorie porte déjà ce nom ; 401, 403 comme
     * categories().
     *
     * @param Request $request Requête entrante.
     */
    public function createCategory(Request $request): void
    {
        $this->requireAdmin();

        $category = $this->validateCategory($request->corps(), null);
        $id       = $this->categories->create(
            $category,
            $this->freeSlug($category['name'], 'categorie', self::CATEGORY_NAME_MAX, fn (string $slug): bool => $this->categories->slugExists($slug)),
        );

        if ($id === null) {
            self::duplicateName();
        }

        Response::json(['category' => $this->categories->findById($id)], 201);
    }

    /**
     * POST /api/admin/categories/update, corps JSON
     * { id, name, description, isVisible, parentId }.
     *
     * Modifie la catégorie (son slug ne change pas) et répond { category }.
     * 400 si id est invalide, 404 si la catégorie n'existe pas ; 422, 409,
     * 401, 403 comme createCategory().
     *
     * @param Request $request Requête entrante.
     */
    public function updateCategory(Request $request): void
    {
        $this->requireAdmin();

        $body    = $request->corps();
        $current = $this->findCategoryOrFail($body['id'] ?? null);

        $category = $this->validateCategory($body, $current);

        if (!$this->categories->update($current['id'], $category, $category['parentId'] !== $current['parentId'])) {
            self::duplicateName();
        }

        Response::json(['category' => $this->categories->findById($current['id'])]);
    }

    /**
     * POST /api/admin/categories/delete, corps JSON { id }.
     *
     * Supprime une catégorie vide et répond { deleted: { id, name } }.
     * 400 si id est invalide, 404 si la catégorie n'existe pas ; 409 si elle
     * contient encore des produits ou des sous-catégories ; 401, 403 comme
     * categories().
     *
     * @param Request $request Requête entrante.
     */
    public function deleteCategory(Request $request): void
    {
        $this->requireAdmin();

        $category = $this->findCategoryOrFail($request->corps()['id'] ?? null);
        $name     = $category['name'];

        if ($category['productCount'] > 0) {
            Response::erreur(
                'Suppression impossible : ' . self::countLabel($category['productCount'], 'produit est encore rangé', 'produits sont encore rangés')
                . " dans {$name}.",
                409,
            );
        }
        if ($category['childCount'] > 0) {
            Response::erreur(
                "Suppression impossible : {$name} contient encore "
                . self::countLabel($category['childCount'], 'sous-catégorie', 'sous-catégories') . '.',
                409,
            );
        }
        if (!$this->categories->delete($category['id'])) {
            Response::erreur("Suppression impossible : {$name} n'est plus vide.", 409);
        }

        Response::json(['deleted' => ['id' => $category['id'], 'name' => $name]]);
    }

    /**
     * GET /api/admin/products
     *
     * Répond { admin, products } : tous les produits, en ligne ou non, par
     * ordre alphabétique, avec leur catégorie, leur nombre de variantes, leur
     * stock total, le stock de leur variante la plus basse (minStock) et leur
     * seuil « Bientôt épuisé » (US GOF-a).
     *
     * 401 si personne n'est connecté, 403 si le compte n'est pas administrateur.
     */
    public function products(): void
    {
        $admin = $this->requireAdmin();

        Response::json([
            'admin'    => ['firstName' => $admin['firstName'], 'lastName' => $admin['lastName']],
            'products' => $this->products->findAdminList(),
        ]);
    }

    /**
     * GET /api/admin/product?id=13, ou sans id pour un nouveau produit.
     *
     * Répond { admin, product, categories, images } :
     * - product : la fiche (voir productDetail), ou null sans id ;
     * - categories : toutes les catégories, masquées comprises (id, name,
     *   parentName, isVisible : visible, parente comprise) ;
     * - images : les photos disponibles (noms de fichier).
     *
     * 400 si id est invalide, 404 si le produit n'existe pas ; 401, 403
     * comme products().
     *
     * @param Request $request Requête entrante.
     */
    public function product(Request $request): void
    {
        $admin = $this->requireAdmin();

        $id = $request->parametre('id');

        Response::json([
            'admin'      => ['firstName' => $admin['firstName'], 'lastName' => $admin['lastName']],
            'product'    => $id === null ? null : $this->productDetail($this->findProductOrFail($id)['id']),
            'categories' => $this->categoryChoices(),
            'images'     => $this->productImages(),
        ]);
    }

    /**
     * POST /api/admin/products, corps JSON
     * { name, description, categoryId, images: ["photo.jpg"…], variantAxis,
     *   lowStockThreshold, isActive, variants: [{ id: null, label, reference,
     *   price, stock }], options: [{ id: null, label, description, price }] }.
     *
     * Crée le produit (slug calculé depuis le nom) et répond { product }, en
     * 201. Le stock initial de chaque variante est journalisé (réassort).
     * 422 (clé « champs ») si la saisie est invalide ; 409 (clé « champs »)
     * si une référence est déjà prise ; 401, 403 comme products().
     *
     * @param Request $request Requête entrante.
     */
    public function createProduct(Request $request): void
    {
        $this->requireAdmin();

        $product = $this->validateProduct($request->corps(), null);
        $id      = $this->products->create(
            $product,
            $this->freeSlug($product['name'], 'produit', self::PRODUCT_NAME_MAX, fn (string $slug): bool => $this->products->slugExists($slug)),
        );

        if ($id === null) {
            self::duplicateVariant();
        }

        Response::json(['product' => $this->productDetail($id)], 201);
    }

    /**
     * POST /api/admin/products/update, corps JSON comme createProduct, avec
     * id, et pour chaque variante existante son id et previousStock (le stock
     * affiché au chargement de la fiche).
     *
     * Enregistre le produit (son slug ne change pas) et répond { product }.
     * Le stock d'une variante reçoit l'écart stock − previousStock : une
     * commande passée entre-temps n'est pas effacée. Les variantes et options
     * absentes du corps sont supprimées, sauf une variante présente dans une
     * commande en cours ou disponible (422).
     * 400 si id est invalide, 404 si le produit n'existe pas ; 422, 409, 401,
     * 403 comme createProduct().
     *
     * @param Request $request Requête entrante.
     */
    public function updateProduct(Request $request): void
    {
        $this->requireAdmin();

        $body    = $request->corps();
        $current = $this->findProductOrFail($body['id'] ?? null);
        $product = $this->validateProduct($body, $current['id']);

        if (!$this->products->update($current['id'], $product)) {
            self::duplicateVariant();
        }

        Response::json(['product' => $this->productDetail($current['id'])]);
    }

    /**
     * POST /api/admin/products/delete, corps JSON { id }.
     *
     * Supprime le produit, ses variantes, ses options et leur journal de
     * stock ; les commandes passées gardent leur copie du nom et du prix.
     * Répond { deleted: { id, name } }.
     * 400 si id est invalide, 404 si le produit n'existe pas ; 409 s'il est
     * dans une commande en cours ou disponible ; 401, 403 comme products().
     *
     * @param Request $request Requête entrante.
     */
    public function deleteProduct(Request $request): void
    {
        $this->requireAdmin();

        $product = $this->findProductOrFail($request->corps()['id'] ?? null);

        if ($this->products->findVariantsInOpenOrders($product['id']) !== []) {
            Response::erreur(
                "Suppression impossible : {$product['name']} est dans une commande en cours ou disponible. "
                . 'Mettez-le hors ligne, puis supprimez-le une fois la commande retirée ou annulée.',
                409,
            );
        }
        if (!$this->products->delete($product['id'])) {
            Response::erreur('Produit introuvable', 404);
        }

        Response::json(['deleted' => ['id' => $product['id'], 'name' => $product['name']]]);
    }

    /**
     * GET /api/admin/promo-codes
     *
     * Répond { admin, promoCodes } : tous les codes promo, du plus récent au
     * plus ancien, chacun avec son statut (status : « actif », « programme »,
     * « expire » ou « epuise », voir promoStatus), calculé à la date du jour
     * à Lyon.
     *
     * 401 si personne n'est connecté, 403 si le compte n'est pas administrateur.
     */
    public function promoCodes(): void
    {
        $admin = $this->requireAdmin();
        $today = self::today()->format('Y-m-d');

        Response::json([
            'admin'      => ['firstName' => $admin['firstName'], 'lastName' => $admin['lastName']],
            'promoCodes' => array_map(
                static fn (array $promoCode): array => $promoCode + ['status' => self::promoStatus($promoCode, $today)],
                $this->promoCodes->findAll(),
            ),
        ]);
    }

    /**
     * POST /api/admin/promo-codes, corps JSON
     * { code, discountRate, minAmount, startsOn, endsOn, maxUses }.
     *
     * Crée le code promo et répond { promoCode }, en 201. 422 (clé
     * « champs ») si la saisie est invalide ; 409 (clé « champs ») si le code
     * existe déjà ; 401, 403 comme promoCodes().
     *
     * @param Request $request Requête entrante.
     */
    public function createPromoCode(Request $request): void
    {
        $this->requireAdmin();

        $id = $this->promoCodes->create($this->validatePromoCode($request->corps(), null));

        if ($id === null) {
            self::duplicateCode();
        }

        Response::json(['promoCode' => $this->promoCodeWithStatus($id)], 201);
    }

    /**
     * POST /api/admin/promo-codes/update, corps JSON
     * { id, code, discountRate, minAmount, startsOn, endsOn, maxUses }.
     *
     * Modifie le code promo (ses utilisations déjà faites restent) et répond
     * { promoCode }. 400 si id est invalide, 404 si le code n'existe pas ;
     * 422, 409, 401, 403 comme createPromoCode().
     *
     * @param Request $request Requête entrante.
     */
    public function updatePromoCode(Request $request): void
    {
        $this->requireAdmin();

        $body    = $request->corps();
        $current = $this->findPromoCodeOrFail($body['id'] ?? null);

        if (!$this->promoCodes->update($current['id'], $this->validatePromoCode($body, $current))) {
            self::duplicateCode();
        }

        Response::json(['promoCode' => $this->promoCodeWithStatus($current['id'])]);
    }

    /**
     * POST /api/admin/promo-codes/delete, corps JSON { id }.
     *
     * Supprime le code promo et répond { deleted: { id, code } }.
     * 400 si id est invalide, 404 si le code n'existe pas ; 401, 403 comme
     * promoCodes().
     *
     * @param Request $request Requête entrante.
     */
    public function deletePromoCode(Request $request): void
    {
        $this->requireAdmin();

        $promoCode = $this->findPromoCodeOrFail($request->corps()['id'] ?? null);
        $this->promoCodes->delete($promoCode['id']);

        Response::json(['deleted' => ['id' => $promoCode['id'], 'code' => $promoCode['code']]]);
    }

    /**
     * Produit désigné par $id. Répond 400 (identifiant invalide) ou 404
     * (produit introuvable), et s'arrête, sinon.
     *
     * @param mixed $id Paramètre ou valeur « id » du corps JSON.
     *
     * @return array<string, mixed> Le produit de ProductModel::findAdminById.
     */
    private function findProductOrFail(mixed $id): array
    {
        $id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false) {
            Response::erreur('Identifiant de produit invalide', 400);
        }

        $product = $this->products->findAdminById($id);

        if ($product === null) {
            Response::erreur('Produit introuvable', 404);
        }

        return $product;
    }

    /**
     * Fiche complète d'un produit existant, pour le back-office.
     *
     * @param int $id Produit existant.
     *
     * @return array<string, mixed> Le produit de findAdminById, avec images
     *                              (noms de fichier, dans l'ordre), variants
     *                              (id, label, reference, price, stock), options
     *                              (id, label, description, price) et
     *                              movements (MOVEMENT_LIMIT derniers mouvements de stock).
     */
    private function productDetail(int $id): array
    {
        return $this->products->findAdminById($id) + [
            'images'    => $this->products->findImages($id),
            'variants'  => $this->products->findAdminVariants($id),
            'options'   => $this->products->findOptions($id),
            'movements' => $this->products->findMovements($id, self::MOVEMENT_LIMIT),
        ];
    }

    /**
     * @return array<int, array{id:int, name:string, parentName:?string, isVisible:bool}>
     *         Toutes les catégories, chaque parente suivie de ses
     *         sous-catégories ; isVisible tient compte de la parente.
     */
    private function categoryChoices(): array
    {
        $tree    = $this->categories->findAdminTree();
        $choices = [];

        for ($i = 0; $i < count($tree); $i++) {
            $choices[] = ['id' => $tree[$i]['id'], 'name' => $tree[$i]['name'], 'parentName' => null, 'isVisible' => $tree[$i]['isVisible']];

            for ($j = 0; $j < count($tree[$i]['children']); $j++) {
                $child     = $tree[$i]['children'][$j];
                $choices[] = [
                    'id'         => $child['id'],
                    'name'       => $child['name'],
                    'parentName' => $tree[$i]['name'],
                    'isVisible'  => $child['isVisible'] && $tree[$i]['isVisible'],
                ];
            }
        }

        return $choices;
    }

    /**
     * Photos proposées au back-office : les fichiers déjà présents dans le
     * dossier des photos produit (front/public/images/produits, copié dans
     * front/dist par npm run build). C'est aussi la liste blanche des noms
     * acceptés pour la table product_image.
     *
     * @return array<int, string> Noms de fichier, par ordre alphabétique.
     */
    private function productImages(): array
    {
        $files = is_dir($this->imageDir) ? scandir($this->imageDir) : false;

        if ($files === false) {
            return [];
        }

        return array_values(array_filter(
            $files,
            fn (string $file): bool => preg_match(self::IMAGE_PATTERN, $file) === 1 && is_file($this->imageDir . '/' . $file),
        ));
    }

    /**
     * Valide la saisie d'un produit. Répond 422 (erreurs par champ, clés
     * « variants.2.reference »… pour les lignes) ou 409 (référence déjà
     * prise), et s'arrête, si elle est refusée.
     *
     * - name : obligatoire, au plus PRODUCT_NAME_MAX caractères ;
     * - description : facultative, au plus PRODUCT_DESCRIPTION_MAX caractères ;
     * - categoryId : une catégorie existante, masquée ou non ;
     * - images : au plus IMAGES_MAX photos de productImages(), sans doublon,
     *   dans l'ordre de la galerie (la première est celle des cartes) ;
     * - variantAxis : facultatif, obligatoire dès deux variantes ;
     * - lowStockThreshold : entier de 0 à THRESHOLD_MAX ;
     * - isActive : booléen ;
     * - variants : de 1 à VARIANTS_MAX lignes (voir validateVariants) ;
     * - options : au plus OPTIONS_MAX lignes (voir validateOptions).
     *
     * @param array<string, mixed> $body      Corps JSON reçu.
     * @param int|null             $productId Produit modifié, ou null à la création.
     *
     * @return array{categoryId:int, name:string, description:?string, images:array<int, string>,
     *               variantAxis:?string, lowStockThreshold:int, isActive:bool,
     *               variants:array<int, array{id:?int, label:string, reference:string, price:string,
     *                                         stockDelta:int}>,
     *               options:array<int, array{id:?int, label:string, description:?string, price:string}>}
     */
    private function validateProduct(array $body, ?int $productId): array
    {
        $errors = [];

        $name = self::cleanText($body['name'] ?? null);
        if ($name === null || $name === '') {
            $errors['name'] = 'Donnez un nom au produit.';
        } elseif (mb_strlen($name) > self::PRODUCT_NAME_MAX) {
            $errors['name'] = 'Le nom ne doit pas dépasser ' . self::PRODUCT_NAME_MAX . ' caractères.';
        }

        // La description garde ses retours à la ligne : seuls les bords sont nettoyés.
        $description = is_string($body['description'] ?? '') ? trim($body['description'] ?? '') : null;
        if ($description === null) {
            $errors['description'] = 'Description invalide.';
        } elseif (mb_strlen($description) > self::PRODUCT_DESCRIPTION_MAX) {
            $errors['description'] = 'La description ne doit pas dépasser ' . self::PRODUCT_DESCRIPTION_MAX . ' caractères.';
        }

        $categoryId = filter_var($body['categoryId'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($categoryId === false || $this->categories->findById($categoryId) === null) {
            $errors['categoryId'] = 'Choisissez une catégorie.';
        }

        $images = $this->validateImages($body['images'] ?? [], $errors);

        $threshold = filter_var(
            $body['lowStockThreshold'] ?? null,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 0, 'max_range' => self::THRESHOLD_MAX]],
        );
        if ($threshold === false) {
            $errors['lowStockThreshold'] = 'Indiquez un nombre d\'unités entre 0 et ' . self::THRESHOLD_MAX . '.';
        }

        $isActive = $body['isActive'] ?? null;
        if (!is_bool($isActive)) {
            $errors['isActive'] = 'Indiquez si le produit est en ligne.';
        }

        $variants = $this->validateVariants($body['variants'] ?? null, $productId, $errors);
        $options  = $this->validateOptions($body['options'] ?? null, $productId, $errors);

        $variantAxis = self::cleanText($body['variantAxis'] ?? '');
        if ($variantAxis === null || mb_strlen($variantAxis) > self::VARIANT_AXIS_MAX) {
            $errors['variantAxis'] = 'Le type de variante ne doit pas dépasser ' . self::VARIANT_AXIS_MAX . ' caractères.';
        } elseif ($variantAxis === '' && count($variants) > 1) {
            $errors['variantAxis'] = 'Indiquez ce qui distingue les variantes : Taille, Coloris…';
        }

        if ($errors !== []) {
            Response::json(['erreur' => 'Certains champs sont à corriger.', 'champs' => $errors], 422);
        }

        // Référence unique dans tout le catalogue : vérifiée après la saisie,
        // comme le nom d'une catégorie.
        $taken = $this->products->findTakenReferences(array_column($variants, 'reference'), $productId);
        if ($taken !== []) {
            $champs = [];
            for ($i = 0; $i < count($variants); $i++) {
                if (in_array($variants[$i]['reference'], $taken, true)) {
                    $champs["variants.{$i}.reference"] = 'Cette référence est déjà celle d\'un autre produit.';
                }
            }
            Response::json(['erreur' => 'Une référence est déjà utilisée par un autre produit.', 'champs' => $champs], 409);
        }

        return [
            'categoryId'        => $categoryId,
            'name'              => $name,
            'description'       => $description === '' ? null : $description,
            'images'            => $images,
            'variantAxis'       => $variantAxis === '' ? null : $variantAxis,
            'lowStockThreshold' => $threshold,
            'isActive'          => $isActive,
            'variants'          => $variants,
            'options'           => $options,
        ];
    }

    /**
     * Valide les variantes saisies. Chaque ligne :
     * - id : null (variante à créer), ou une variante du produit, une seule fois ;
     * - label : obligatoire, au plus VARIANT_LABEL_MAX caractères, unique dans le produit ;
     * - reference : obligatoire, lettres, chiffres et tirets (mise en
     *   majuscules), au plus REFERENCE_MAX caractères, unique ;
     * - price : prix TTC positif de la variante, « 379,90 » ou 379.9 ;
     * - stock : entier de 0 à STOCK_MAX ; previousStock (variante existante) :
     *   le stock affiché au chargement, dont on tire l'écart à appliquer.
     * Une variante retirée ne doit pas être dans une commande en cours ou disponible.
     *
     * @param mixed                 $variants  Valeur « variants » du corps JSON.
     * @param int|null              $productId Produit modifié, ou null.
     * @param array<string, string> $errors    Erreurs par champ, complétées ici.
     *
     * @return array<int, array{id:?int, label:string, reference:string, price:string, stockDelta:int}>
     */
    private function validateVariants(mixed $variants, ?int $productId, array &$errors): array
    {
        if (!is_array($variants) || !array_is_list($variants) || $variants === []) {
            $errors['variants'] = 'Ajoutez au moins une variante (« Unique » pour un produit sans déclinaison).';
            return [];
        }
        if (count($variants) > self::VARIANTS_MAX) {
            $errors['variants'] = 'Un produit a au plus ' . self::VARIANTS_MAX . ' variantes.';
            return [];
        }

        $existingIds = $productId === null ? [] : array_column($this->products->findAdminVariants($productId), 'id');
        $valid       = [];
        $labels      = [];
        $references  = [];

        for ($i = 0; $i < count($variants); $i++) {
            $row = is_array($variants[$i]) ? $variants[$i] : [];
            $key = "variants.{$i}";

            $id = $row['id'] ?? null;
            if ($id !== null) {
                $id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                if ($id === false || !in_array($id, $existingIds, true) || in_array($id, array_column($valid, 'id'), true)) {
                    $errors[$key . '.label'] = 'Cette variante n\'appartient pas au produit : rechargez la page.';
                    continue;
                }
            }

            $label = self::cleanText($row['label'] ?? null);
            if ($label === null || $label === '') {
                $errors[$key . '.label'] = 'Donnez un libellé (S, Noir, 1 L, Unique…).';
            } elseif (mb_strlen($label) > self::VARIANT_LABEL_MAX) {
                $errors[$key . '.label'] = 'Au plus ' . self::VARIANT_LABEL_MAX . ' caractères.';
            } elseif (in_array(mb_strtolower($label), $labels, true)) {
                $errors[$key . '.label'] = 'Deux variantes ont ce libellé.';
            }

            $reference = is_string($row['reference'] ?? null) ? strtoupper(trim($row['reference'])) : '';
            if ($reference === '') {
                $errors[$key . '.reference'] = 'Donnez une référence.';
            } elseif (strlen($reference) > self::REFERENCE_MAX || preg_match('/^[A-Z0-9][A-Z0-9-]*$/', $reference) !== 1) {
                $errors[$key . '.reference'] = 'Lettres, chiffres et tirets, au plus ' . self::REFERENCE_MAX . ' caractères.';
            } elseif (in_array($reference, $references, true)) {
                $errors[$key . '.reference'] = 'Deux variantes ont cette référence.';
            }

            $price = self::parsePrice($row['price'] ?? null);
            if ($price === null) {
                $errors[$key . '.price'] = 'Un prix en euros, par exemple 379,90.';
            }

            $stockRange = ['options' => ['min_range' => 0, 'max_range' => self::STOCK_MAX]];
            $stock      = filter_var($row['stock'] ?? null, FILTER_VALIDATE_INT, $stockRange);
            $previous   = $id === null ? 0 : filter_var($row['previousStock'] ?? null, FILTER_VALIDATE_INT, $stockRange);
            if ($stock === false || $previous === false) {
                $errors[$key . '.stock'] = 'Un nombre entier, de 0 à ' . self::STOCK_MAX . '.';
            }

            $labels[]     = mb_strtolower($label ?? '');
            $references[] = $reference;
            $valid[]      = [
                'id'         => $id,
                'label'      => $label ?? '',
                'reference'  => $reference,
                'price'      => $price ?? '0.00',
                'stockDelta' => is_int($stock) && is_int($previous) ? $stock - $previous : 0,
            ];
        }

        if ($productId !== null) {
            $removed = array_diff($existingIds, array_column($valid, 'id'));
            $locked  = array_intersect($removed, $this->products->findVariantsInOpenOrders($productId));
            if ($locked !== []) {
                $errors['variants'] = 'Une variante retirée est dans une commande en cours ou disponible : '
                    . 'gardez-la jusqu\'au retrait ou à l\'annulation de la commande.';
            }
        }

        return $valid;
    }

    /**
     * Valide les photos saisies : une liste de noms de fichier, chacun parmi
     * productImages(), sans doublon, au plus IMAGES_MAX.
     *
     * @param mixed                 $images Valeur « images » du corps JSON.
     * @param array<string, string> $errors Erreurs par champ, complétées ici.
     *
     * @return array<int, string> Les photos, dans l'ordre reçu.
     */
    private function validateImages(mixed $images, array &$errors): array
    {
        if (!is_array($images) || !array_is_list($images) || count($images) > self::IMAGES_MAX) {
            $errors['images'] = 'Choisissez au plus ' . self::IMAGES_MAX . ' photos.';
            return [];
        }

        $available = $this->productImages();
        $valid     = [];

        for ($i = 0; $i < count($images); $i++) {
            if (!is_string($images[$i]) || !in_array($images[$i], $available, true)) {
                $errors["images.{$i}"] = 'Choisissez une photo de la liste.';
            } elseif (in_array($images[$i], $valid, true)) {
                $errors["images.{$i}"] = 'Cette photo est déjà choisie.';
            } else {
                $valid[] = $images[$i];
            }
        }

        return $valid;
    }

    /**
     * Valide les options saisies (US OPT-c). Chaque ligne :
     * - id : null (option à créer), ou une option du produit, une seule fois ;
     * - label : obligatoire, au plus OPTION_LABEL_MAX caractères, unique dans le produit ;
     * - description : facultative, au plus OPTION_DESCRIPTION_MAX caractères ;
     * - price : supplément TTC positif.
     *
     * @param mixed                 $options   Valeur « options » du corps JSON.
     * @param int|null              $productId Produit modifié, ou null.
     * @param array<string, string> $errors    Erreurs par champ, complétées ici.
     *
     * @return array<int, array{id:?int, label:string, description:?string, price:string}>
     */
    private function validateOptions(mixed $options, ?int $productId, array &$errors): array
    {
        $options = $options ?? [];

        if (!is_array($options) || !array_is_list($options) || count($options) > self::OPTIONS_MAX) {
            $errors['options'] = 'Un produit propose au plus ' . self::OPTIONS_MAX . ' options.';
            return [];
        }

        $existingIds = $productId === null ? [] : array_column($this->products->findOptions($productId), 'id');
        $valid       = [];
        $labels      = [];

        for ($i = 0; $i < count($options); $i++) {
            $row = is_array($options[$i]) ? $options[$i] : [];
            $key = "options.{$i}";

            $id = $row['id'] ?? null;
            if ($id !== null) {
                $id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
                if ($id === false || !in_array($id, $existingIds, true) || in_array($id, array_column($valid, 'id'), true)) {
                    $errors[$key . '.label'] = 'Cette option n\'appartient pas au produit : rechargez la page.';
                    continue;
                }
            }

            $label = self::cleanText($row['label'] ?? null);
            if ($label === null || $label === '') {
                $errors[$key . '.label'] = 'Donnez un libellé (Pose en atelier…).';
            } elseif (mb_strlen($label) > self::OPTION_LABEL_MAX) {
                $errors[$key . '.label'] = 'Au plus ' . self::OPTION_LABEL_MAX . ' caractères.';
            } elseif (in_array(mb_strtolower($label), $labels, true)) {
                $errors[$key . '.label'] = 'Deux options ont ce libellé.';
            }

            $description = self::cleanText($row['description'] ?? '');
            if ($description === null || mb_strlen($description) > self::OPTION_DESCRIPTION_MAX) {
                $errors[$key . '.description'] = 'Au plus ' . self::OPTION_DESCRIPTION_MAX . ' caractères.';
            }

            $price = self::parsePrice($row['price'] ?? null);
            if ($price === null) {
                $errors[$key . '.price'] = 'Un supplément en euros, par exemple 30.';
            }

            $labels[] = mb_strtolower($label ?? '');
            $valid[]  = [
                'id'          => $id,
                'label'       => $label ?? '',
                'description' => $description === '' ? null : $description,
                'price'       => $price ?? '0.00',
            ];
        }

        return $valid;
    }

    /**
     * Répond 409 (référence ou libellé déjà pris entre la validation et
     * l'enregistrement) et s'arrête.
     */
    private static function duplicateVariant(): void
    {
        Response::erreur('Une référence ou un libellé vient d\'être pris : vérifiez les variantes et options, puis réessayez.', 409);
    }

    /**
     * @param mixed $price Prix reçu : nombre, ou texte « 379,90 », « 379,90 € ».
     *
     * @return string|null Le prix pour une colonne DECIMAL(8,2), « 379.90 »,
     *                     ou null s'il est invalide ou négatif.
     */
    private static function parsePrice(mixed $price): ?string
    {
        if (is_int($price) || is_float($price)) {
            $price = (string) $price;
        }
        if (!is_string($price)) {
            return null;
        }

        // Espaces (insécables comprises) et symbole retirés, virgule décimale acceptée.
        $price = str_replace([',', '€'], ['.', ''], preg_replace('/\s+/u', '', $price) ?? '');

        if (preg_match('/^\d{1,6}(\.\d{1,2})?$/', $price) !== 1) {
            return null;
        }

        return number_format((float) $price, 2, '.', '');
    }

    /**
     * Catégorie désignée par $id. Répond 400 (identifiant invalide) ou 404
     * (catégorie introuvable), et s'arrête, sinon.
     *
     * @param mixed $id Valeur « id » du corps JSON.
     *
     * @return array{id:int, parentId:?int, name:string, slug:string, description:?string,
     *               isVisible:bool, productCount:int, childCount:int}
     */
    private function findCategoryOrFail(mixed $id): array
    {
        $id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false) {
            Response::erreur('Identifiant de catégorie invalide', 400);
        }

        $category = $this->categories->findById($id);

        if ($category === null) {
            Response::erreur('Catégorie introuvable', 404);
        }

        return $category;
    }

    /**
     * Valide la saisie d'une catégorie. Répond 422 (erreurs par champ) ou
     * 409 (nom déjà pris), et s'arrête, si elle est refusée.
     *
     * - name : obligatoire, au plus CATEGORY_NAME_MAX caractères, unique ;
     * - description : facultative, au plus CATEGORY_DESCRIPTION_MAX caractères ;
     * - isVisible : booléen ;
     * - parentId : null, ou une catégorie de premier niveau autre qu'elle-même.
     *   Un seul niveau de sous-catégorie : une catégorie qui a des
     *   sous-catégories reste au premier niveau.
     *
     * @param array<string, mixed> $body    Corps JSON reçu.
     * @param array<string, mixed>|null $current Catégorie modifiée (findById), ou null à la création.
     *
     * @return array{parentId:?int, name:string, description:?string, isVisible:bool}
     */
    private function validateCategory(array $body, ?array $current): array
    {
        $errors = [];

        $name = self::cleanText($body['name'] ?? null);
        if ($name === null || $name === '') {
            $errors['name'] = 'Donnez un nom à la catégorie.';
        } elseif (mb_strlen($name) > self::CATEGORY_NAME_MAX) {
            $errors['name'] = 'Le nom ne doit pas dépasser ' . self::CATEGORY_NAME_MAX . ' caractères.';
        }

        $description = self::cleanText($body['description'] ?? '');
        if ($description === null) {
            $errors['description'] = 'Description invalide.';
        } elseif (mb_strlen($description) > self::CATEGORY_DESCRIPTION_MAX) {
            $errors['description'] = 'La description ne doit pas dépasser ' . self::CATEGORY_DESCRIPTION_MAX . ' caractères.';
        }

        $isVisible = $body['isVisible'] ?? null;
        if (!is_bool($isVisible)) {
            $errors['isVisible'] = 'Indiquez si la catégorie est visible.';
        }

        $parentId = $this->validateParent($body['parentId'] ?? null, $current);
        if (is_string($parentId)) {
            $errors['parentId'] = $parentId;
        }

        if ($errors !== []) {
            Response::json(['erreur' => 'Certains champs sont à corriger.', 'champs' => $errors], 422);
        }

        if ($this->categories->nameExists($name, $current['id'] ?? null)) {
            self::duplicateName();
        }

        return [
            'parentId'    => $parentId,
            'name'        => $name,
            'description' => $description === '' ? null : $description,
            'isVisible'   => $isVisible,
        ];
    }

    /**
     * @param mixed                     $parentId Valeur « parentId » du corps JSON.
     * @param array<string, mixed>|null $current  Catégorie modifiée, ou null.
     *
     * @return int|string|null La parente validée (null : premier niveau), ou
     *                         le message d'erreur du champ.
     */
    private function validateParent(mixed $parentId, ?array $current): int|string|null
    {
        if ($parentId === null) {
            return null;
        }

        $parentId = filter_var($parentId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $parent   = $parentId === false ? null : $this->categories->findById($parentId);

        if ($parent === null || $parent['parentId'] !== null) {
            return 'Choisissez une catégorie de premier niveau.';
        }
        if ($current !== null && $parent['id'] === $current['id']) {
            return 'Une catégorie ne peut pas être sa propre parente.';
        }
        if ($current !== null && $current['childCount'] > 0) {
            return 'Cette catégorie a des sous-catégories : elle reste au premier niveau.';
        }

        return $parent['id'];
    }

    /**
     * Répond 409 (nom déjà pris) et s'arrête.
     */
    private static function duplicateName(): void
    {
        Response::json([
            'erreur' => 'Une catégorie porte déjà ce nom.',
            'champs' => ['name' => 'Une catégorie porte déjà ce nom.'],
        ], 409);
    }

    /**
     * Code promo désigné par $id. Répond 400 (identifiant invalide) ou 404
     * (code introuvable), et s'arrête, sinon.
     *
     * @param mixed $id Valeur « id » du corps JSON.
     *
     * @return array{id:int, code:string, discountRate:int, minAmount:float, startsOn:?string,
     *               endsOn:?string, maxUses:?int, useCount:int}
     */
    private function findPromoCodeOrFail(mixed $id): array
    {
        $id = filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false) {
            Response::erreur('Identifiant de code promo invalide', 400);
        }

        $promoCode = $this->promoCodes->findById($id);

        if ($promoCode === null) {
            Response::erreur('Code promo introuvable', 404);
        }

        return $promoCode;
    }

    /**
     * @param int $id Code promo qui vient d'être enregistré.
     *
     * @return array<string, mixed> Le code promo, avec son statut du jour.
     */
    private function promoCodeWithStatus(int $id): array
    {
        $promoCode = $this->promoCodes->findById($id);

        return $promoCode + ['status' => self::promoStatus($promoCode, self::today()->format('Y-m-d'))];
    }

    /**
     * Valide la saisie d'un code promo. Répond 422 (erreurs par champ) ou
     * 409 (code déjà pris), et s'arrête, si elle est refusée.
     *
     * - code : obligatoire, mis en majuscules, PROMO_CODE_PATTERN, unique ;
     * - discountRate : entier de PROMO_RATE_MIN à PROMO_RATE_MAX ;
     * - minAmount : facultatif (vide : sans minimum), montant comme un prix ;
     * - startsOn, endsOn : facultatifs, dates « 2026-12-31 », la fin au plus
     *   tôt le jour du début. Une fin déjà passée n'est refusée que si elle
     *   est saisie : un code expiré reste modifiable ;
     * - maxUses : facultatif (vide : illimité), entier de 1 à PROMO_USES_MAX,
     *   et pas moins que les utilisations déjà faites.
     *
     * @param array<string, mixed>      $body    Corps JSON reçu.
     * @param array<string, mixed>|null $current Code modifié (findById), ou null à la création.
     *
     * @return array{code:string, discountRate:int, minAmount:string, startsOn:?string, endsOn:?string,
     *               maxUses:?int}
     */
    private function validatePromoCode(array $body, ?array $current): array
    {
        $errors = [];

        $code = self::cleanText($body['code'] ?? null);
        $code = $code === null ? null : strtoupper(str_replace(' ', '', $code));
        if ($code === null || $code === '') {
            $errors['code'] = 'Saisissez le code.';
        } elseif (preg_match(self::PROMO_CODE_PATTERN, $code) !== 1) {
            $errors['code'] = 'De 3 à 20 caractères : lettres sans accent et chiffres.';
        }

        $rate = filter_var($body['discountRate'] ?? null, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => self::PROMO_RATE_MIN, 'max_range' => self::PROMO_RATE_MAX],
        ]);
        if ($rate === false) {
            $errors['discountRate'] = 'Une réduction entière de ' . self::PROMO_RATE_MIN . ' à ' . self::PROMO_RATE_MAX . ' %.';
        }

        $minAmount = $body['minAmount'] ?? '';
        $minAmount = $minAmount === '' || $minAmount === null ? '0.00' : self::parsePrice($minAmount);
        if ($minAmount === null) {
            $errors['minAmount'] = 'Montant invalide, par exemple 50,00.';
        }

        $startsOn = self::parseDate($body['startsOn'] ?? null);
        if ($startsOn === false) {
            $errors['startsOn'] = 'Date de début invalide.';
        }

        $endsOn = self::parseDate($body['endsOn'] ?? null);
        if ($endsOn === false) {
            $errors['endsOn'] = 'Date de fin invalide.';
        } elseif ($endsOn !== null && is_string($startsOn) && $endsOn < $startsOn) {
            $errors['endsOn'] = 'La fin doit être au plus tôt le jour du début.';
        } elseif ($endsOn !== null && $endsOn < self::today()->format('Y-m-d') && $endsOn !== ($current['endsOn'] ?? null)) {
            $errors['endsOn'] = 'Cette date est déjà passée.';
        }

        $maxUses = $body['maxUses'] ?? null;
        $useCount = $current['useCount'] ?? 0;
        if ($maxUses !== null && $maxUses !== '') {
            $maxUses = filter_var($maxUses, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1, 'max_range' => self::PROMO_USES_MAX],
            ]);
            if ($maxUses === false) {
                $errors['maxUses'] = 'Un nombre entier de 1 à ' . self::PROMO_USES_MAX . ', ou vide pour illimité.';
            } elseif ($maxUses < $useCount) {
                $errors['maxUses'] = "Déjà utilisé {$useCount} fois : la limite ne peut pas être plus basse.";
            }
        } else {
            $maxUses = null;
        }

        if ($errors !== []) {
            Response::json(['erreur' => 'Certains champs sont à corriger.', 'champs' => $errors], 422);
        }

        if ($this->promoCodes->codeExists($code, $current['id'] ?? null)) {
            self::duplicateCode();
        }

        return [
            'code'         => $code,
            'discountRate' => $rate,
            'minAmount'    => $minAmount,
            'startsOn'     => $startsOn,
            'endsOn'       => $endsOn,
            'maxUses'      => $maxUses,
        ];
    }

    /**
     * @param mixed $date Valeur reçue : « 2026-12-31 », chaîne vide ou null.
     *
     * @return string|false|null La date « 2026-12-31 », null si elle est
     *                           vide, false si elle est invalide.
     */
    private static function parseDate(mixed $date): string|false|null
    {
        if ($date === null || $date === '') {
            return null;
        }
        if (!is_string($date)) {
            return false;
        }

        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);

        // createFromFormat accepte le 31/02 en le reportant au 03/03 : la
        // relecture doit redonner la saisie.
        return $parsed !== false && $parsed->format('Y-m-d') === $date ? $date : false;
    }

    /**
     * Statut d'un code promo à une date donnée. Expiré et programmé passent
     * avant épuisé : c'est la date qui explique d'abord qu'il ne marche pas.
     * Sert aussi au client, au panier et à la commande (CartController,
     * US PRO-a) : seul un code « actif » s'utilise.
     *
     * @param array{startsOn:?string, endsOn:?string, maxUses:?int, useCount:int} $promoCode
     * @param string $today Aujourd'hui, « 2026-10-22 ».
     *
     * @return string « expire », « programme », « epuise » ou « actif ».
     */
    public static function promoStatus(array $promoCode, string $today): string
    {
        if ($promoCode['endsOn'] !== null && $promoCode['endsOn'] < $today) {
            return 'expire';
        }
        if ($promoCode['startsOn'] !== null && $promoCode['startsOn'] > $today) {
            return 'programme';
        }
        if ($promoCode['maxUses'] !== null && $promoCode['useCount'] >= $promoCode['maxUses']) {
            return 'epuise';
        }

        return 'actif';
    }

    /**
     * Répond 409 (code promo déjà pris) et s'arrête.
     */
    private static function duplicateCode(): void
    {
        Response::json([
            'erreur' => 'Ce code existe déjà.',
            'champs' => ['code' => 'Ce code existe déjà.'],
        ], 409);
    }

    /**
     * Slug libre calculé depuis le nom : « Équipement et confort » donne
     * « equipement-et-confort », puis « equipement-et-confort-2 » s'il est pris.
     *
     * @param string                  $name      Nom déjà validé.
     * @param string                  $fallback  Slug d'un nom sans lettre ni chiffre.
     * @param int                     $maxLength Longueur de la colonne slug.
     * @param callable(string): bool  $isTaken   Le slug est-il déjà pris ?
     *
     * @return string
     */
    private function freeSlug(string $name, string $fallback, int $maxLength, callable $isTaken): string
    {
        $base = strtr(mb_strtolower($name), self::SLUG_LETTERS);
        $base = trim(preg_replace('/[^a-z0-9]+/', '-', $base) ?? '', '-');
        $base = $base === '' ? $fallback : substr($base, 0, $maxLength - 4);

        $slug = $base;
        for ($suffix = 2; $isTaken($slug); $suffix++) {
            $slug = "{$base}-{$suffix}";
        }

        return $slug;
    }

    /**
     * @param mixed $text Valeur reçue.
     *
     * @return string|null Le texte sans espaces superflus, ou null si ce
     *                     n'est pas une chaîne.
     */
    private static function cleanText(mixed $text): ?string
    {
        return is_string($text) ? trim(preg_replace('/\s+/u', ' ', $text) ?? '') : null;
    }

    /**
     * @param int    $count
     * @param string $singular
     * @param string $plural
     *
     * @return string « 1 produit est encore rangé », « 6 produits sont encore rangés »…
     */
    private static function countLabel(int $count, string $singular, string $plural): string
    {
        return $count . ' ' . ($count > 1 ? $plural : $singular);
    }

    /**
     * Commande détaillée, avec dayOffset. Répond 404 (et s'arrête) si elle
     * n'existe pas.
     *
     * @param int $id Identifiant déjà validé.
     *
     * @return array<string, mixed> La commande de OrderModel::findAdminDetail, avec dayOffset.
     */
    private function findDetailOrFail(int $id): array
    {
        $order = $this->orders->findAdminDetail($id);

        if ($order === null) {
            Response::erreur('Commande introuvable', 404);
        }

        return $order + ['dayOffset' => self::dayOffset($order['pickupStart'], self::today())];
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

    /**
     * @return DateTimeImmutable Aujourd'hui à minuit, à l'heure de Lyon.
     */
    private static function today(): DateTimeImmutable
    {
        return (new DateTimeImmutable('now', new DateTimeZone(self::TIMEZONE)))->setTime(0, 0);
    }

    /**
     * Nettoie la recherche « N° ou client » : espaces superflus retirés,
     * longueur bornée.
     *
     * @param string|null $search Paramètre q reçu.
     *
     * @return string|null La recherche, ou null si elle est vide.
     */
    private static function normalizeSearch(?string $search): ?string
    {
        $search = mb_substr(trim(preg_replace('/\s+/u', ' ', $search ?? '') ?? ''), 0, self::SEARCH_MAX_LENGTH);

        return $search === '' ? null : $search;
    }

    /**
     * Valide la sélection reçue : une liste non vide d'au plus BULK_MAX
     * identifiants > 0. Les doublons sont retirés.
     *
     * @param mixed $ids Valeur « ids » du corps JSON.
     *
     * @return array<int, int>|null null si invalide.
     */
    private static function validateIds(mixed $ids): ?array
    {
        if (!is_array($ids) || !array_is_list($ids) || $ids === [] || count($ids) > self::BULK_MAX) {
            return null;
        }

        $valid = [];

        for ($i = 0; $i < count($ids); $i++) {
            $id = filter_var($ids[$i], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

            if ($id === false) {
                return null;
            }

            $valid[] = $id;
        }

        return array_values(array_unique($valid));
    }
}
