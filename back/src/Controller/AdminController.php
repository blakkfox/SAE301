<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\CategoryModel;
use App\Model\CustomerModel;
use App\Model\OrderModel;
use App\Model\ProductModel;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Back-office : tableau de bord (US GOF-b), gestion des commandes (US PIL-b)
 * et gestion des catégories (US GOF-c).
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
        $id       = $this->categories->create($category, $this->freeSlug($category['name']));

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
     * Slug libre calculé depuis le nom : « Équipement et confort » donne
     * « equipement-et-confort », puis « equipement-et-confort-2 » s'il est pris.
     *
     * @param string $name Nom déjà validé.
     *
     * @return string
     */
    private function freeSlug(string $name): string
    {
        $base = strtr(mb_strtolower($name), self::SLUG_LETTERS);
        $base = trim(preg_replace('/[^a-z0-9]+/', '-', $base) ?? '', '-');
        $base = $base === '' ? 'categorie' : substr($base, 0, self::CATEGORY_NAME_MAX - 4);

        $slug = $base;
        for ($suffix = 2; $this->categories->slugExists($slug); $suffix++) {
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
