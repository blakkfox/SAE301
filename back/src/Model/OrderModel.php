<?php

declare(strict_types=1);

namespace App\Model;

use DateTimeImmutable;
use PDO;
use PDOStatement;
use Throwable;

/**
 * Accès aux commandes (US CMD-a), à leur gestion au back-office (US PIL-b) et
 * à l'historique du client (US SUI-c).
 *
 * L'enregistrement d'une commande, la baisse des stocks et leur journal
 * (US STK-a, StockModel) se font dans UNE transaction : si un seul article
 * manque, rien n'est enregistré. De même, un changement de statut et sa
 * ligne du journal order_event, et une annulation et son recrédit, sont
 * écrits ensemble ou pas du tout.
 */
final class OrderModel
{
    /** Format DATETIME de MySQL. */
    private const DATETIME = 'Y-m-d H:i:s';

    /** Connexion à la base, fournie à la construction. */
    private PDO $pdo;

    /** Mouvements de stock, écrits dans la transaction de la commande. */
    private StockModel $stock;

    /**
     * @param PDO        $pdo   Connexion ouverte par Database::connexion().
     * @param StockModel $stock Mouvements de stock, sur la même connexion.
     */
    public function __construct(PDO $pdo, StockModel $stock)
    {
        $this->pdo   = $pdo;
        $this->stock = $stock;
    }

    /**
     * Enregistre une commande « en cours », baisse le stock de ses variantes
     * et journalise chaque baisse (StockModel::decrementForOrder).
     *
     * Chaque baisse n'a lieu que si le stock suffit (« stock >= quantité »),
     * et c'est MySQL qui le vérifie, ligne verrouillée : deux commandes
     * simultanées ne peuvent pas vendre la même dernière unité. Les variantes
     * dont le stock ne suffit pas, ou dont le produit a été retiré du
     * catalogue, sont toutes relevées ; s'il y en a une seule, la transaction
     * est annulée : ni commande, ni baisse, ni journal.
     *
     * Nom, variante, référence et prix sont copiés depuis la base dans les
     * lignes de commande : le prix ne vient jamais du navigateur. Il en va de
     * même des options cochées (US OPT-a) : libellé et supplément sont copiés
     * depuis product_option, et une option qui n'appartient pas au produit de
     * sa ligne annule toute la commande.
     *
     * @param int                                                                    $customerId   Compte connecté.
     * @param int                                                                    $dealershipId Concession, déjà vérifiée.
     * @param DateTimeImmutable                                                      $pickupStart  Début du créneau.
     * @param DateTimeImmutable                                                      $pickupEnd    Fin du créneau.
     * @param array<int, array{variantId:int, quantity:int, optionIds:array<int, int>}> $items     Lignes déjà validées,
     *                                                                                             sans doublon de variante.
     *
     * @return array{orderId:?int, unavailable:array<int, int>, refusedOptions:array<int, int>}
     *         orderId : la commande créée, ou null si rien n'a été enregistré ;
     *         unavailable : les variantes en rupture dans ce cas ;
     *         refusedOptions : les variantes dont une option est refusée.
     */
    public function create(
        int $customerId,
        int $dealershipId,
        DateTimeImmutable $pickupStart,
        DateTimeImmutable $pickupEnd,
        array $items,
    ): array {
        $this->pdo->beginTransaction();

        try {
            // La commande est créée d'abord : le journal des mouvements la
            // référence. Elle disparaît avec le rollBack si un article manque.
            $orderId     = $this->insertOrder($customerId, $dealershipId, $pickupStart, $pickupEnd);
            $unavailable = $this->stock->decrementForOrder($orderId, $items);

            if ($unavailable !== []) {
                $this->pdo->rollBack();

                return ['orderId' => null, 'unavailable' => $unavailable, 'refusedOptions' => []];
            }

            $refusedOptions = $this->insertLines($orderId, $items);

            if ($refusedOptions !== []) {
                $this->pdo->rollBack();

                return ['orderId' => null, 'unavailable' => [], 'refusedOptions' => $refusedOptions];
            }

            $this->updateTotal($orderId);
            $this->insertEvent($orderId, 'en_cours', null);

            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return ['orderId' => $orderId, 'unavailable' => [], 'refusedOptions' => []];
    }

    /**
     * Une commande, avec sa concession et ses lignes.
     *
     * @param int $id Identifiant de la commande.
     *
     * @return array{id:int, status:string, total:float, pickupStart:string, pickupEnd:string,
     *               createdAt:string, dealership:array{id:int, name:string, shortName:string},
     *               lines:array<int, array{variantId:?int, name:string, label:string,
     *                                      reference:string, unitPrice:float, quantity:int,
     *                                      options:array<int, array{label:string, price:float}>}>}|null
     *         null si la commande n'existe pas.
     */
    public function findById(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT customer_order.id, customer_order.status, customer_order.total,
                    customer_order.pickup_start, customer_order.pickup_end, customer_order.created_at,
                    dealership.id AS dealership_id, dealership.name AS dealership_name,
                    dealership.short_name AS dealership_short_name
               FROM customer_order
         INNER JOIN dealership ON dealership.id = customer_order.dealership_id
              WHERE customer_order.id = :id'
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();

        $row = $statement->fetch();

        if ($row === false) {
            return null;
        }

        return [
            'id'          => (int) $row['id'],
            'status'      => $row['status'],
            'total'       => (float) $row['total'],
            'pickupStart' => $row['pickup_start'],
            'pickupEnd'   => $row['pickup_end'],
            'createdAt'   => $row['created_at'],
            'dealership'  => [
                'id'        => (int) $row['dealership_id'],
                'name'      => $row['dealership_name'],
                'shortName' => $row['dealership_short_name'],
            ],
            'lines'       => $this->findLines($id),
        ];
    }

    /**
     * Historique d'un client (US SUI-c) : ses commandes, des plus récentes aux
     * plus anciennes, chacune avec sa concession, ses lignes et le journal de
     * ses statuts (US PIL-b). Le journal ne dit pas quel administrateur a
     * changé le statut : le client n'a pas à le savoir.
     *
     * Trois requêtes en tout (commandes, lignes, journal), quel que soit le
     * nombre de commandes, plutôt qu'une paire de requêtes par commande.
     *
     * @param int                    $customerId Compte connecté.
     * @param DateTimeImmutable|null $since      Commandes passées depuis cette date,
     *                                           ou null pour toutes.
     *
     * @return array<int, array{id:int, status:string, total:float, pickupStart:string,
     *                          pickupEnd:string, createdAt:string,
     *                          dealership:array{id:int, name:string, shortName:string},
     *                          lines:array<int, array{variantId:?int, name:string, label:string,
     *                                                 reference:string, unitPrice:float, quantity:int}>,
     *                          events:array<int, array{status:string, createdAt:string}>}>
     */
    public function findCustomerHistory(int $customerId, ?DateTimeImmutable $since): array
    {
        $filter = self::historyFilter($since);

        $statement = $this->pdo->prepare(
            'SELECT customer_order.id, customer_order.status, customer_order.total,
                    customer_order.pickup_start, customer_order.pickup_end, customer_order.created_at,
                    dealership.id AS dealership_id, dealership.name AS dealership_name,
                    dealership.short_name AS dealership_short_name
               FROM customer_order
         INNER JOIN dealership ON dealership.id = customer_order.dealership_id
              WHERE ' . $filter . '
           ORDER BY customer_order.created_at DESC, customer_order.id DESC'
        );
        self::bindHistory($statement, $customerId, $since);
        $statement->execute();
        $orders = $statement->fetchAll();

        if ($orders === []) {
            return [];
        }

        $lines  = $this->findHistoryLines($filter, $customerId, $since);
        $events = $this->findHistoryEvents($filter, $customerId, $since);

        return array_map(
            static fn (array $row): array => [
                'id'          => (int) $row['id'],
                'status'      => $row['status'],
                'total'       => (float) $row['total'],
                'pickupStart' => $row['pickup_start'],
                'pickupEnd'   => $row['pickup_end'],
                'createdAt'   => $row['created_at'],
                'dealership'  => [
                    'id'        => (int) $row['dealership_id'],
                    'name'      => $row['dealership_name'],
                    'shortName' => $row['dealership_short_name'],
                ],
                'lines'       => $lines[(int) $row['id']] ?? [],
                'events'      => $events[(int) $row['id']] ?? [],
            ],
            $orders,
        );
    }

    /**
     * Dernière commande d'un client (US SUI-b), avec sa concession et ses
     * lignes : la plus récente, quel que soit son statut.
     *
     * @param int $customerId Compte connecté.
     *
     * @return array{id:int, status:string, total:float, pickupStart:string, pickupEnd:string,
     *               createdAt:string, dealership:array{id:int, name:string, shortName:string},
     *               lines:array<int, array{variantId:?int, name:string, label:string,
     *                                      reference:string, unitPrice:float, quantity:int,
     *                                      options:array<int, array{label:string, price:float}>}>}|null
     *         null si le client n'a jamais commandé.
     */
    public function findLastByCustomer(int $customerId): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT id FROM customer_order
              WHERE customer_id = :customer
           ORDER BY created_at DESC, id DESC
              LIMIT 1'
        );
        $statement->bindValue(':customer', $customerId, PDO::PARAM_INT);
        $statement->execute();
        $id = $statement->fetchColumn();

        return $id === false ? null : $this->findById((int) $id);
    }

    /**
     * Une commande d'un client (US SUI-a), avec sa concession, ses lignes et
     * le journal de ses statuts, sans l'administrateur : le client n'a pas à
     * le savoir (comme findCustomerHistory).
     *
     * @param int $id         Identifiant de la commande.
     * @param int $customerId Compte connecté.
     *
     * @return array{id:int, status:string, total:float, pickupStart:string, pickupEnd:string,
     *               createdAt:string, dealership:array{id:int, name:string, shortName:string},
     *               lines:array<int, array{variantId:?int, name:string, label:string,
     *                                      reference:string, unitPrice:float, quantity:int,
     *                                      options:array<int, array{label:string, price:float}>}>,
     *               events:array<int, array{status:string, createdAt:string}>}|null
     *         null si la commande n'existe pas ou appartient à un autre client.
     */
    public function findCustomerOrder(int $id, int $customerId): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT id FROM customer_order WHERE id = :id AND customer_id = :customer'
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->bindValue(':customer', $customerId, PDO::PARAM_INT);
        $statement->execute();

        if ($statement->fetchColumn() === false) {
            return null;
        }

        $order = $this->findById($id);

        return $order + [
            'events' => array_map(
                static fn (array $event): array => ['status' => $event['status'], 'createdAt' => $event['createdAt']],
                $this->findEvents($id),
            ),
        ];
    }

    /**
     * Nombre de commandes de chaque statut, pour le tableau de bord du
     * back-office (US GOF-b) et les pastilles de filtre de la gestion des
     * commandes (US PIL-b). Un statut sans commande vaut 0.
     *
     * @param string|null $search Numéro ou nom du client (voir searchFilter),
     *                            ou null pour compter toutes les commandes.
     *
     * @return array{en_cours:int, disponible:int, retiree:int, annulee:int}
     */
    public function countByStatus(?string $search = null): array
    {
        $counts = ['en_cours' => 0, 'disponible' => 0, 'retiree' => 0, 'annulee' => 0];

        $statement = $this->pdo->prepare(
            'SELECT customer_order.status, COUNT(*) AS order_count
               FROM customer_order
         INNER JOIN customer ON customer.id = customer_order.customer_id
              WHERE 1 = 1' . self::searchFilter($search) . '
           GROUP BY customer_order.status'
        );
        self::bindSearch($statement, $search);
        $statement->execute();

        $rows = $statement->fetchAll();

        for ($i = 0; $i < count($rows); $i++) {
            $counts[$rows[$i]['status']] = (int) $rows[$i]['order_count'];
        }

        return $counts;
    }

    /**
     * Prochaines commandes à préparer ou à remettre (statut « en_cours » ou
     * « disponible »), par début de créneau : les plus urgentes d'abord
     * (US GOF-b).
     *
     * @param int $limit Nombre de commandes.
     *
     * @return array<int, array{id:int, status:string, total:float, pickupStart:string,
     *                          customer:array{firstName:string, lastName:string}}>
     */
    public function findUpcoming(int $limit): array
    {
        $statement = $this->pdo->prepare(
            'SELECT customer_order.id, customer_order.status, customer_order.total, customer_order.pickup_start,
                    customer.first_name, customer.last_name
               FROM customer_order
         INNER JOIN customer ON customer.id = customer_order.customer_id
              WHERE customer_order.status IN (\'en_cours\', \'disponible\')
           ORDER BY customer_order.pickup_start, customer_order.id
              LIMIT :limit'
        );
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'id'          => (int) $row['id'],
                'status'      => $row['status'],
                'total'       => (float) $row['total'],
                'pickupStart' => $row['pickup_start'],
                'customer'    => [
                    'firstName' => $row['first_name'],
                    'lastName'  => $row['last_name'],
                ],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Une page de la liste des commandes du back-office (US PIL-b).
     *
     * @param string      $orderBy Fragment SQL de tri, par exemple « customer_order.total DESC ».
     *                             ATTENTION : ce fragment est inséré tel quel dans la
     *                             requête. Il ne doit JAMAIS provenir directement de
     *                             l'utilisateur — voir la liste blanche du contrôleur.
     * @param int         $limit   Nombre de commandes à renvoyer.
     * @param int         $offset  Nombre de commandes à sauter (pagination).
     * @param string|null $status  Statut à garder, déjà validé, ou null pour tous.
     * @param string|null $search  Numéro ou nom du client (voir searchFilter), ou null.
     *
     * @return array<int, array{id:int, status:string, total:float, pickupStart:string,
     *                          customer:array{firstName:string, lastName:string}}>
     */
    public function findAdminPage(string $orderBy, int $limit, int $offset, ?string $status, ?string $search): array
    {
        // customer_order.id en dernier critère : deux commandes au même total
        // gardent toujours le même ordre d'une page à l'autre.
        $statement = $this->pdo->prepare(
            'SELECT customer_order.id, customer_order.status, customer_order.total, customer_order.pickup_start,
                    customer.first_name, customer.last_name
               FROM customer_order
         INNER JOIN customer ON customer.id = customer_order.customer_id
              WHERE 1 = 1' . self::statusFilter($status) . self::searchFilter($search) . "
           ORDER BY {$orderBy}, customer_order.id DESC
              LIMIT :limit OFFSET :offset"
        );
        self::bindStatus($statement, $status);
        self::bindSearch($statement, $search);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'id'          => (int) $row['id'],
                'status'      => $row['status'],
                'total'       => (float) $row['total'],
                'pickupStart' => $row['pickup_start'],
                'customer'    => [
                    'firstName' => $row['first_name'],
                    'lastName'  => $row['last_name'],
                ],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Une commande telle que le back-office la détaille (US PIL-b) : celle de
     * findById, avec le client et le journal de ses statuts.
     *
     * @param int $id Identifiant de la commande.
     *
     * @return array{id:int, status:string, total:float, pickupStart:string, pickupEnd:string,
     *               createdAt:string, dealership:array{id:int, name:string, shortName:string},
     *               lines:array<int, array{variantId:?int, name:string, label:string,
     *                                      reference:string, unitPrice:float, quantity:int,
     *                                      options:array<int, array{label:string, price:float}>}>,
     *               customer:array{firstName:string, lastName:string, phone:string},
     *               events:array<int, array{status:string, createdAt:string,
     *                                       admin:?array{firstName:string, lastName:string}}>}|null
     *         null si la commande n'existe pas.
     */
    public function findAdminDetail(int $id): ?array
    {
        $order = $this->findById($id);

        if ($order === null) {
            return null;
        }

        $statement = $this->pdo->prepare(
            'SELECT customer.first_name, customer.last_name, customer.phone
               FROM customer_order
         INNER JOIN customer ON customer.id = customer_order.customer_id
              WHERE customer_order.id = :id'
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
        $row = $statement->fetch();

        return $order + [
            'customer' => [
                'firstName' => $row['first_name'],
                'lastName'  => $row['last_name'],
                'phone'     => $row['phone'],
            ],
            'events'   => $this->findEvents($id),
        ];
    }

    /**
     * Fait passer des commandes de $from à $to, et journalise chaque passage
     * (US PIL-b). Seules les commandes encore au statut $from changent : la
     * condition est vérifiée par MySQL, ligne verrouillée, si bien que deux
     * administrateurs ne peuvent pas faire le même passage deux fois.
     *
     * @param array<int, int> $ids     Commandes demandées, sans doublon.
     * @param string          $from    Statut requis, déjà validé.
     * @param string          $to      Nouveau statut, déjà validé.
     * @param int             $adminId Administrateur connecté.
     *
     * @return array<int, int> Les commandes qui ont changé de statut.
     */
    public function advanceStatus(array $ids, string $from, string $to, int $adminId): array
    {
        $update = $this->pdo->prepare(
            'UPDATE customer_order SET status = :to WHERE id = :id AND status = :from'
        );

        $updated = [];

        $this->pdo->beginTransaction();

        try {
            for ($i = 0; $i < count($ids); $i++) {
                $update->bindValue(':to', $to);
                $update->bindValue(':id', $ids[$i], PDO::PARAM_INT);
                $update->bindValue(':from', $from);
                $update->execute();

                if ($update->rowCount() === 0) {
                    continue;
                }

                $this->insertEvent($ids[$i], $to, $adminId);
                $updated[] = $ids[$i];
            }

            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return $updated;
    }

    /**
     * Annule une commande « en_cours » ou « disponible », journalise
     * l'annulation et recrédite le stock de ses variantes
     * (StockModel::restockOrder), dans une transaction (US PIL-b). Une
     * commande retirée, ou déjà annulée, ne change pas.
     *
     * @param int $id      Commande à annuler.
     * @param int $adminId Administrateur connecté.
     *
     * @return bool true si la commande a été annulée.
     */
    public function cancel(int $id, int $adminId): bool
    {
        $this->pdo->beginTransaction();

        try {
            $update = $this->pdo->prepare(
                'UPDATE customer_order SET status = \'annulee\'
                  WHERE id = :id AND status IN (\'en_cours\', \'disponible\')'
            );
            $update->bindValue(':id', $id, PDO::PARAM_INT);
            $update->execute();

            if ($update->rowCount() === 0) {
                $this->pdo->rollBack();

                return false;
            }

            $this->insertEvent($id, 'annulee', $adminId);
            $this->stock->restockOrder($id);

            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return true;
    }

    /**
     * @param int               $customerId
     * @param int               $dealershipId
     * @param DateTimeImmutable $pickupStart
     * @param DateTimeImmutable $pickupEnd
     *
     * @return int Identifiant de la commande créée (total à 0, voir updateTotal).
     */
    private function insertOrder(
        int $customerId,
        int $dealershipId,
        DateTimeImmutable $pickupStart,
        DateTimeImmutable $pickupEnd,
    ): int {
        $statement = $this->pdo->prepare(
            'INSERT INTO customer_order (customer_id, dealership_id, pickup_start, pickup_end, status)
             VALUES (:customer, :dealership, :start, :end, \'en_cours\')'
        );
        $statement->bindValue(':customer', $customerId, PDO::PARAM_INT);
        $statement->bindValue(':dealership', $dealershipId, PDO::PARAM_INT);
        $statement->bindValue(':start', $pickupStart->format(self::DATETIME));
        $statement->bindValue(':end', $pickupEnd->format(self::DATETIME));
        $statement->execute();

        return (int) $this->pdo->lastInsertId();
    }

    /**
     * Copie, pour chaque ligne, le nom, la variante (libellé complet,
     * « Taille M », US OPT-b), la référence et le prix tels qu'ils sont en
     * base, puis ses options (US OPT-a) : leur libellé et leur supplément,
     * ajouté au prix unitaire de la ligne.
     *
     * Une option n'est copiée que si elle appartient au produit de la
     * variante : MySQL le vérifie par la jointure, si bien qu'un identifiant
     * inventé ou d'un autre produit ne copie rien et est relevé.
     *
     * @param int                                                                    $orderId
     * @param array<int, array{variantId:int, quantity:int, optionIds:array<int, int>}> $items
     *
     * @return array<int, int> Variantes dont une option est refusée (vide si tout va bien).
     */
    private function insertLines(int $orderId, array $items): array
    {
        $line = $this->pdo->prepare(
            'INSERT INTO order_line (order_id, variant_id, product_name, variant_label, reference, unit_price, quantity)
             SELECT :order, variant.id, product.name, ' . ProductModel::VARIANT_LABEL . ',
                    variant.reference, product.price, :quantity
               FROM variant
         INNER JOIN product ON product.id = variant.product_id
              WHERE variant.id = :variant'
        );
        $option = $this->pdo->prepare(
            'INSERT INTO order_line_option (order_line_id, option_id, label, price)
             SELECT :line, product_option.id, product_option.label, product_option.price
               FROM product_option
         INNER JOIN variant ON variant.product_id = product_option.product_id
              WHERE product_option.id = :option AND variant.id = :variant'
        );
        // COALESCE : si toutes les options sont refusées, SUM vaut NULL ; la
        // ligne garde alors son prix le temps que create annule la commande.
        $price = $this->pdo->prepare(
            'UPDATE order_line
                SET unit_price = unit_price
                               + (SELECT COALESCE(SUM(price), 0) FROM order_line_option WHERE order_line_id = :options)
              WHERE id = :line'
        );

        $refused = [];

        for ($i = 0; $i < count($items); $i++) {
            $line->bindValue(':order', $orderId, PDO::PARAM_INT);
            $line->bindValue(':quantity', $items[$i]['quantity'], PDO::PARAM_INT);
            $line->bindValue(':variant', $items[$i]['variantId'], PDO::PARAM_INT);
            $line->execute();

            $optionIds = $items[$i]['optionIds'];

            if ($optionIds === []) {
                continue;
            }

            $lineId = (int) $this->pdo->lastInsertId();

            for ($j = 0; $j < count($optionIds); $j++) {
                $option->bindValue(':line', $lineId, PDO::PARAM_INT);
                $option->bindValue(':option', $optionIds[$j], PDO::PARAM_INT);
                $option->bindValue(':variant', $items[$i]['variantId'], PDO::PARAM_INT);
                $option->execute();

                if ($option->rowCount() === 0) {
                    $refused[] = $items[$i]['variantId'];
                }
            }

            $price->bindValue(':options', $lineId, PDO::PARAM_INT);
            $price->bindValue(':line', $lineId, PDO::PARAM_INT);
            $price->execute();
        }

        return array_values(array_unique($refused));
    }

    /**
     * Fige le total de la commande à partir de ses lignes.
     *
     * @param int $orderId
     */
    private function updateTotal(int $orderId): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE customer_order
                SET total = (SELECT SUM(unit_price * quantity) FROM order_line WHERE order_id = :lines)
              WHERE id = :order'
        );
        $statement->bindValue(':lines', $orderId, PDO::PARAM_INT);
        $statement->bindValue(':order', $orderId, PDO::PARAM_INT);
        $statement->execute();
    }

    /**
     * Lignes d'une commande, dans l'ordre d'enregistrement, chacune avec ses
     * options (US OPT-a). unitPrice comprend déjà leurs suppléments.
     *
     * @param int $orderId
     *
     * @return array<int, array{variantId:?int, name:string, label:string, reference:string,
     *                          unitPrice:float, quantity:int,
     *                          options:array<int, array{label:string, price:float}>}>
     */
    private function findLines(int $orderId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, variant_id, product_name, variant_label, reference, unit_price, quantity
               FROM order_line
              WHERE order_id = :order
           ORDER BY id'
        );
        $statement->bindValue(':order', $orderId, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll();

        $options = $this->findLineOptions($orderId);

        return array_map(
            static fn (array $row): array => [
                'variantId' => $row['variant_id'] === null ? null : (int) $row['variant_id'],
                'name'      => $row['product_name'],
                'label'     => $row['variant_label'],
                'reference' => $row['reference'],
                'unitPrice' => (float) $row['unit_price'],
                'quantity'  => (int) $row['quantity'],
                'options'   => $options[(int) $row['id']] ?? [],
            ],
            $rows,
        );
    }

    /**
     * Options des lignes d'une commande (US OPT-a), rangées par ligne, dans
     * l'ordre où elles ont été enregistrées.
     *
     * @param int $orderId
     *
     * @return array<int, array<int, array{label:string, price:float}>> Clé : identifiant de la ligne.
     */
    private function findLineOptions(int $orderId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT order_line_option.order_line_id, order_line_option.label, order_line_option.price
               FROM order_line_option
         INNER JOIN order_line ON order_line.id = order_line_option.order_line_id
              WHERE order_line.order_id = :order
           ORDER BY order_line_option.id'
        );
        $statement->bindValue(':order', $orderId, PDO::PARAM_INT);
        $statement->execute();
        $rows = $statement->fetchAll();

        $options = [];

        for ($i = 0; $i < count($rows); $i++) {
            $options[(int) $rows[$i]['order_line_id']][] = [
                'label' => $rows[$i]['label'],
                'price' => (float) $rows[$i]['price'],
            ];
        }

        return $options;
    }

    /**
     * Inscrit un statut dans le journal order_event (US PIL-b).
     *
     * @param int      $orderId
     * @param string   $status  Statut atteint.
     * @param int|null $adminId Administrateur qui l'a fait, ou null à la
     *                          création de la commande par le client.
     */
    private function insertEvent(int $orderId, string $status, ?int $adminId): void
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO order_event (order_id, status, admin_id) VALUES (:order, :status, :admin)'
        );
        $statement->bindValue(':order', $orderId, PDO::PARAM_INT);
        $statement->bindValue(':status', $status);
        $statement->bindValue(':admin', $adminId, $adminId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $statement->execute();
    }

    /**
     * Journal des statuts d'une commande, du plus ancien au plus récent.
     *
     * @param int $orderId
     *
     * @return array<int, array{status:string, createdAt:string,
     *                          admin:?array{firstName:string, lastName:string}}>
     *         admin vaut null pour la création par le client.
     */
    private function findEvents(int $orderId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT order_event.status, order_event.created_at,
                    customer.first_name, customer.last_name
               FROM order_event
          LEFT JOIN customer ON customer.id = order_event.admin_id
              WHERE order_event.order_id = :order
           ORDER BY order_event.created_at, order_event.id'
        );
        $statement->bindValue(':order', $orderId, PDO::PARAM_INT);
        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'status'    => $row['status'],
                'createdAt' => $row['created_at'],
                'admin'     => $row['first_name'] === null
                    ? null
                    : ['firstName' => $row['first_name'], 'lastName' => $row['last_name']],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Lignes des commandes de l'historique, rangées par commande.
     *
     * @param string                 $filter     Condition de historyFilter.
     * @param int                    $customerId
     * @param DateTimeImmutable|null $since
     *
     * @return array<int, array<int, array{variantId:?int, name:string, label:string, reference:string,
     *                                     unitPrice:float, quantity:int}>> Clé : identifiant de la commande.
     */
    private function findHistoryLines(string $filter, int $customerId, ?DateTimeImmutable $since): array
    {
        $statement = $this->pdo->prepare(
            'SELECT order_line.order_id, order_line.variant_id, order_line.product_name,
                    order_line.variant_label, order_line.reference, order_line.unit_price, order_line.quantity
               FROM order_line
         INNER JOIN customer_order ON customer_order.id = order_line.order_id
              WHERE ' . $filter . '
           ORDER BY order_line.id'
        );
        self::bindHistory($statement, $customerId, $since);
        $statement->execute();
        $rows = $statement->fetchAll();

        $lines = [];

        for ($i = 0; $i < count($rows); $i++) {
            $lines[(int) $rows[$i]['order_id']][] = [
                'variantId' => $rows[$i]['variant_id'] === null ? null : (int) $rows[$i]['variant_id'],
                'name'      => $rows[$i]['product_name'],
                'label'     => $rows[$i]['variant_label'],
                'reference' => $rows[$i]['reference'],
                'unitPrice' => (float) $rows[$i]['unit_price'],
                'quantity'  => (int) $rows[$i]['quantity'],
            ];
        }

        return $lines;
    }

    /**
     * Journal des statuts des commandes de l'historique, rangé par commande,
     * du plus ancien au plus récent.
     *
     * @param string                 $filter     Condition de historyFilter.
     * @param int                    $customerId
     * @param DateTimeImmutable|null $since
     *
     * @return array<int, array<int, array{status:string, createdAt:string}>> Clé : identifiant de la commande.
     */
    private function findHistoryEvents(string $filter, int $customerId, ?DateTimeImmutable $since): array
    {
        $statement = $this->pdo->prepare(
            'SELECT order_event.order_id, order_event.status, order_event.created_at
               FROM order_event
         INNER JOIN customer_order ON customer_order.id = order_event.order_id
              WHERE ' . $filter . '
           ORDER BY order_event.created_at, order_event.id'
        );
        self::bindHistory($statement, $customerId, $since);
        $statement->execute();
        $rows = $statement->fetchAll();

        $events = [];

        for ($i = 0; $i < count($rows); $i++) {
            $events[(int) $rows[$i]['order_id']][] = [
                'status'    => $rows[$i]['status'],
                'createdAt' => $rows[$i]['created_at'],
            ];
        }

        return $events;
    }

    /**
     * @param DateTimeImmutable|null $since Début de la période, ou null.
     *
     * @return string Condition SQL des commandes de l'historique : celles du
     *                client, passées depuis $since. La requête doit lire la
     *                table customer_order.
     */
    private static function historyFilter(?DateTimeImmutable $since): string
    {
        return 'customer_order.customer_id = :customer'
            . ($since === null ? '' : ' AND customer_order.created_at >= :since');
    }

    /**
     * Lie les marqueurs de historyFilter.
     *
     * @param PDOStatement           $statement
     * @param int                    $customerId
     * @param DateTimeImmutable|null $since
     */
    private static function bindHistory(PDOStatement $statement, int $customerId, ?DateTimeImmutable $since): void
    {
        $statement->bindValue(':customer', $customerId, PDO::PARAM_INT);

        if ($since !== null) {
            $statement->bindValue(':since', $since->format(self::DATETIME));
        }
    }

    /**
     * @param string|null $status Statut déjà validé, ou null.
     *
     * @return string Condition SQL à ajouter au WHERE (vide sans statut).
     */
    private static function statusFilter(?string $status): string
    {
        return $status === null ? '' : ' AND customer_order.status = :status';
    }

    /**
     * Lie le marqueur :status de statusFilter, s'il est présent.
     *
     * @param PDOStatement $statement
     * @param string|null  $status
     */
    private static function bindStatus(PDOStatement $statement, ?string $status): void
    {
        if ($status !== null) {
            $statement->bindValue(':status', $status);
        }
    }

    /**
     * Recherche « N° ou client » : le numéro de la commande (« 142 »,
     * « CMD-0142 »), ou une partie du nom du client, prénom avant ou après le
     * nom. La requête doit joindre la table customer.
     *
     * @param string|null $search Saisie déjà nettoyée, ou null.
     *
     * @return string Condition SQL à ajouter au WHERE (vide sans recherche).
     */
    private static function searchFilter(?string $search): string
    {
        return $search === null
            ? ''
            : ' AND (customer_order.id = :searchId
                     OR CONCAT_WS(\' \', customer.first_name, customer.last_name) LIKE :searchName
                     OR CONCAT_WS(\' \', customer.last_name, customer.first_name) LIKE :searchReverse)';
    }

    /**
     * Lie les marqueurs de searchFilter, s'ils sont présents. Une saisie qui
     * n'est pas un numéro est cherchée sous l'identifiant 0, qu'aucune
     * commande ne porte.
     *
     * @param PDOStatement $statement
     * @param string|null  $search
     */
    private static function bindSearch(PDOStatement $statement, ?string $search): void
    {
        if ($search === null) {
            return;
        }

        $id = preg_match('/^(?:CMD-?)?0*(\d{1,9})$/i', $search, $matches) === 1 ? (int) $matches[1] : 0;
        // % et _ saisis sont cherchés tels quels, pas comme jokers de LIKE.
        $like = '%' . addcslashes($search, '%_\\') . '%';

        $statement->bindValue(':searchId', $id, PDO::PARAM_INT);
        $statement->bindValue(':searchName', $like);
        $statement->bindValue(':searchReverse', $like);
    }
}
