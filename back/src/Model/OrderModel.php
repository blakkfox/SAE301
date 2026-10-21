<?php

declare(strict_types=1);

namespace App\Model;

use DateTimeImmutable;
use PDO;
use Throwable;

/**
 * Accès aux commandes (US CMD-a).
 *
 * L'enregistrement d'une commande, la baisse des stocks et leur journal
 * (US STK-a, StockModel) se font dans UNE transaction : si un seul article
 * manque, rien n'est enregistré.
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
     * lignes de commande : le prix ne vient jamais du navigateur.
     *
     * @param int                                           $customerId   Compte connecté.
     * @param int                                           $dealershipId Concession, déjà vérifiée.
     * @param DateTimeImmutable                             $pickupStart  Début du créneau.
     * @param DateTimeImmutable                             $pickupEnd    Fin du créneau.
     * @param array<int, array{variantId:int, quantity:int}> $items       Lignes déjà validées,
     *                                                                    sans doublon de variante.
     *
     * @return array{orderId:?int, unavailable:array<int, int>}
     *         orderId : la commande créée, ou null si rien n'a été enregistré ;
     *         unavailable : les variantes en cause dans ce cas.
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

                return ['orderId' => null, 'unavailable' => $unavailable];
            }

            $this->insertLines($orderId, $items);
            $this->updateTotal($orderId);

            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return ['orderId' => $orderId, 'unavailable' => []];
    }

    /**
     * Une commande, avec sa concession et ses lignes.
     *
     * @param int $id Identifiant de la commande.
     *
     * @return array{id:int, status:string, total:float, pickupStart:string, pickupEnd:string,
     *               createdAt:string, dealership:array{id:int, name:string, shortName:string},
     *               lines:array<int, array{variantId:?int, name:string, label:string,
     *                                      reference:string, unitPrice:float, quantity:int}>}|null
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
     * Copie, pour chaque ligne, le nom, la variante, la référence et le prix
     * tels qu'ils sont en base.
     *
     * @param int                                           $orderId
     * @param array<int, array{variantId:int, quantity:int}> $items
     */
    private function insertLines(int $orderId, array $items): void
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO order_line (order_id, variant_id, product_name, variant_label, reference, unit_price, quantity)
             SELECT :order, variant.id, product.name, variant.label, variant.reference, product.price, :quantity
               FROM variant
         INNER JOIN product ON product.id = variant.product_id
              WHERE variant.id = :variant'
        );

        for ($i = 0; $i < count($items); $i++) {
            $statement->bindValue(':order', $orderId, PDO::PARAM_INT);
            $statement->bindValue(':quantity', $items[$i]['quantity'], PDO::PARAM_INT);
            $statement->bindValue(':variant', $items[$i]['variantId'], PDO::PARAM_INT);
            $statement->execute();
        }
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
     * Lignes d'une commande, dans l'ordre d'enregistrement.
     *
     * @param int $orderId
     *
     * @return array<int, array{variantId:?int, name:string, label:string, reference:string,
     *                          unitPrice:float, quantity:int}>
     */
    private function findLines(int $orderId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT variant_id, product_name, variant_label, reference, unit_price, quantity
               FROM order_line
              WHERE order_id = :order
           ORDER BY id'
        );
        $statement->bindValue(':order', $orderId, PDO::PARAM_INT);
        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'variantId' => $row['variant_id'] === null ? null : (int) $row['variant_id'],
                'name'      => $row['product_name'],
                'label'     => $row['variant_label'],
                'reference' => $row['reference'],
                'unitPrice' => (float) $row['unit_price'],
                'quantity'  => (int) $row['quantity'],
            ],
            $statement->fetchAll(),
        );
    }
}
