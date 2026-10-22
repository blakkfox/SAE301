<?php

declare(strict_types=1);

namespace App\Model;

use LogicException;
use PDO;

/**
 * Mise à jour automatique des stocks (US STK-a).
 *
 * Chaque baisse ou recrédit du stock d'une variante est inscrit dans le
 * journal stock_movement. Ces méthodes n'ouvrent pas de transaction : elles
 * s'exécutent dans celle de l'appelant (OrderModel, qui enregistre la
 * commande ou son annulation en même temps ; ProductModel, qui enregistre la
 * fiche produit au back-office, US GOF-a). Si l'appelant annule, stock et
 * journal reviennent ensemble à leur état précédent.
 */
final class StockModel
{
    /** Connexion à la base, la même que celle de OrderModel (même transaction). */
    private PDO $pdo;

    /**
     * @param PDO $pdo Connexion ouverte par Database::connexion().
     */
    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    /**
     * Baisse le stock de chaque variante commandée et journalise la baisse,
     * si le stock suffit et si le produit est toujours au catalogue : actif,
     * et rangé dans une catégorie visible, parente comprise (US GOF-c).
     *
     * La condition « stock >= quantité » est vérifiée par MySQL, ligne
     * verrouillée : deux commandes simultanées ne peuvent pas vendre la même
     * dernière unité. Toutes les variantes sont examinées, pour relever
     * toutes celles qui manquent ; c'est à l'appelant d'annuler la
     * transaction s'il y en a une.
     *
     * Pas de EXISTS sur variant (voir ProductModel::VISIBLE) : MySQL refuse
     * qu'une sous-requête lise la table modifiée. La variante existe, puisque
     * la ligne est mise à jour.
     *
     * @param int                                            $orderId Commande en cours d'enregistrement.
     * @param array<int, array{variantId:int, quantity:int}> $items   Lignes déjà validées,
     *                                                                sans doublon de variante.
     *
     * @return array<int, int> Les variantes qui n'ont pas pu être servies.
     */
    public function decrementForOrder(int $orderId, array $items): array
    {
        $this->requireTransaction();

        // Un marqueur ne peut pas apparaître deux fois (préparation réelle) :
        // la quantité est donc liée à :quantity et à :needed.
        $update = $this->pdo->prepare(
            'UPDATE variant
         INNER JOIN product ON product.id = variant.product_id
         INNER JOIN category AS shown ON shown.id = product.category_id
          LEFT JOIN category AS shown_parent ON shown_parent.id = shown.parent_id
                SET variant.stock = variant.stock - :quantity
              WHERE variant.id = :variant
                AND variant.stock >= :needed
                AND product.is_active = 1
                AND shown.is_visible = 1
                AND (shown_parent.id IS NULL OR shown_parent.is_visible = 1)'
        );

        // Le stock relu ici est déjà baissé : la ligne est verrouillée par
        // l'UPDATE, jusqu'à la fin de la transaction.
        $log = $this->pdo->prepare(
            'INSERT INTO stock_movement (variant_id, order_id, reason, quantity, stock_after)
             SELECT id, :order, \'commande\', :delta, stock
               FROM variant
              WHERE id = :variant'
        );

        $unavailable = [];

        for ($i = 0; $i < count($items); $i++) {
            $update->bindValue(':quantity', $items[$i]['quantity'], PDO::PARAM_INT);
            $update->bindValue(':needed', $items[$i]['quantity'], PDO::PARAM_INT);
            $update->bindValue(':variant', $items[$i]['variantId'], PDO::PARAM_INT);
            $update->execute();

            if ($update->rowCount() === 0) {
                $unavailable[] = $items[$i]['variantId'];
                continue;
            }

            $log->bindValue(':order', $orderId, PDO::PARAM_INT);
            $log->bindValue(':delta', -$items[$i]['quantity'], PDO::PARAM_INT);
            $log->bindValue(':variant', $items[$i]['variantId'], PDO::PARAM_INT);
            $log->execute();
        }

        return $unavailable;
    }

    /**
     * Recrédite le stock des variantes d'une commande annulée, et journalise
     * le recrédit (appelée par PIL-b, après le passage au statut « annulee »).
     *
     * Une commande ne se recrédite qu'une fois : si le journal contient déjà
     * son annulation, rien n'est fait. Les lignes dont la variante a été
     * supprimée (variant_id NULL) sont ignorées : il n'y a plus de stock à
     * recréditer.
     *
     * @param int $orderId Commande annulée.
     *
     * @return int Nombre de variantes recréditées (0 si déjà fait).
     */
    public function restockOrder(int $orderId): int
    {
        $this->requireTransaction();

        if ($this->isRestocked($orderId)) {
            return 0;
        }

        // Une commande n'a jamais deux lignes pour la même variante
        // (OrderController::validateItems) : chaque variante est recréditée une fois.
        $update = $this->pdo->prepare(
            'UPDATE variant
         INNER JOIN order_line ON order_line.variant_id = variant.id
                SET variant.stock = variant.stock + order_line.quantity
              WHERE order_line.order_id = :order'
        );
        $update->bindValue(':order', $orderId, PDO::PARAM_INT);
        $update->execute();

        $log = $this->pdo->prepare(
            'INSERT INTO stock_movement (variant_id, order_id, reason, quantity, stock_after)
             SELECT variant.id, order_line.order_id, \'annulation\', order_line.quantity, variant.stock
               FROM order_line
         INNER JOIN variant ON variant.id = order_line.variant_id
              WHERE order_line.order_id = :order'
        );
        $log->bindValue(':order', $orderId, PDO::PARAM_INT);
        $log->execute();

        return $log->rowCount();
    }

    /**
     * Applique au stock d'une variante l'écart saisi au back-office (US
     * GOF-a), et journalise le mouvement : « reassort » s'il monte,
     * « ajustement » s'il baisse.
     *
     * C'est un écart, et non une valeur absolue, qui est reçu : une commande
     * passée pendant que l'administrateur modifiait la fiche n'est pas
     * effacée par l'enregistrement. Le stock ne descend jamais sous 0.
     *
     * @param int $variantId Variante du produit enregistré.
     * @param int $delta     Unités ajoutées (> 0) ou retirées (< 0).
     *
     * @return int L'écart réellement appliqué (0 si rien n'a changé).
     */
    public function adjust(int $variantId, int $delta): int
    {
        $this->requireTransaction();

        // FOR UPDATE : la ligne reste verrouillée jusqu'à la fin de la
        // transaction, une commande simultanée attend son tour.
        $select = $this->pdo->prepare('SELECT stock FROM variant WHERE id = :variant FOR UPDATE');
        $select->bindValue(':variant', $variantId, PDO::PARAM_INT);
        $select->execute();

        $current = $select->fetchColumn();
        if ($current === false) {
            return 0;
        }

        // Calcul en PHP : stock est UNSIGNED, « stock + -5 » échouerait en SQL.
        $stock   = max(0, (int) $current + $delta);
        $applied = $stock - (int) $current;

        if ($applied === 0) {
            return 0;
        }

        $update = $this->pdo->prepare('UPDATE variant SET stock = :stock WHERE id = :variant');
        $update->bindValue(':stock', $stock, PDO::PARAM_INT);
        $update->bindValue(':variant', $variantId, PDO::PARAM_INT);
        $update->execute();

        $log = $this->pdo->prepare(
            'INSERT INTO stock_movement (variant_id, order_id, reason, quantity, stock_after)
             VALUES (:variant, NULL, :reason, :delta, :stock)'
        );
        $log->bindValue(':variant', $variantId, PDO::PARAM_INT);
        $log->bindValue(':reason', $applied > 0 ? 'reassort' : 'ajustement');
        $log->bindValue(':delta', $applied, PDO::PARAM_INT);
        $log->bindValue(':stock', $stock, PDO::PARAM_INT);
        $log->execute();

        return $applied;
    }

    /**
     * @param int $orderId
     *
     * @return bool true si le journal contient déjà l'annulation de cette commande.
     */
    private function isRestocked(int $orderId): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT 1 FROM stock_movement WHERE order_id = :order AND reason = \'annulation\' LIMIT 1'
        );
        $statement->bindValue(':order', $orderId, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchColumn() !== false;
    }

    /**
     * Stock et journal ne doivent jamais être écrits hors d'une transaction :
     * une erreur entre les deux les ferait diverger.
     *
     * @throws LogicException Si aucune transaction n'est ouverte.
     */
    private function requireTransaction(): void
    {
        if (!$this->pdo->inTransaction()) {
            throw new LogicException('StockModel doit être appelé dans une transaction.');
        }
    }
}
