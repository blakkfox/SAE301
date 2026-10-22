<?php

declare(strict_types=1);

namespace App\Model;

use PDO;
use PDOException;
use PDOStatement;

/**
 * Accès aux codes promo, gérés au back-office (US PRO-b) et utilisés par le
 * client au panier et à la commande (US PRO-a).
 *
 * Comme CategoryModel, cette couche exécute les requêtes et renvoie des
 * tableaux typés, sans rien décider : le statut d'un code (actif, programmé,
 * expiré, épuisé) est déduit par le contrôleur.
 */
final class PromoCodeModel
{
    /** Colonnes lues pour un code promo. */
    private const COLUMNS = 'id, code, discount_rate, min_amount, starts_on, ends_on, max_uses, use_count';

    /** Code SQLSTATE d'une contrainte violée (clé unique). */
    private const INTEGRITY_VIOLATION = '23000';

    /** Connexion à la base, fournie à la construction. */
    private PDO $pdo;

    /**
     * @param PDO $pdo Connexion ouverte par Database::connexion().
     */
    public function __construct(PDO $pdo)
    {
        $this->pdo = $pdo;
    }

    /**
     * Tous les codes promo, du plus récent au plus ancien.
     *
     * @return array<int, array{id:int, code:string, discountRate:int, minAmount:float, startsOn:?string,
     *               endsOn:?string, maxUses:?int, useCount:int}>
     */
    public function findAll(): array
    {
        $sql = 'SELECT ' . self::COLUMNS . ' FROM promo_code ORDER BY id DESC';

        return array_map([self::class, 'toPromoCode'], $this->pdo->query($sql)->fetchAll());
    }

    /**
     * @param int $id Identifiant du code promo.
     *
     * @return array{id:int, code:string, discountRate:int, minAmount:float, startsOn:?string,
     *               endsOn:?string, maxUses:?int, useCount:int}|null
     *         null si le code n'existe pas.
     */
    public function findById(int $id): ?array
    {
        $statement = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM promo_code WHERE id = :id');
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();

        $row = $statement->fetch();

        return $row === false ? null : self::toPromoCode($row);
    }

    /**
     * Code promo saisi par le client (US PRO-a).
     *
     * @param string $code Code saisi, déjà mis en majuscules.
     *
     * @return array{id:int, code:string, discountRate:int, minAmount:float, startsOn:?string,
     *               endsOn:?string, maxUses:?int, useCount:int}|null
     *         null si aucun code promo ne porte ce code.
     */
    public function findByCode(string $code): ?array
    {
        $statement = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM promo_code WHERE code = :code');
        $statement->bindValue(':code', $code);
        $statement->execute();

        $row = $statement->fetch();

        return $row === false ? null : self::toPromoCode($row);
    }

    /**
     * Compte une utilisation du code (US PRO-a), dans la transaction de la
     * commande (OrderModel::create, même connexion).
     *
     * C'est MySQL qui vérifie la limite (« use_count < max_uses »), ligne
     * verrouillée : deux commandes simultanées ne peuvent pas prendre la
     * dernière utilisation.
     *
     * @param int $id
     *
     * @return bool false si le code a atteint son nombre d'utilisations (ou n'existe plus).
     */
    public function consume(int $id): bool
    {
        $statement = $this->pdo->prepare(
            'UPDATE promo_code
                SET use_count = use_count + 1
              WHERE id = :id AND (max_uses IS NULL OR use_count < max_uses)'
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();

        return $statement->rowCount() === 1;
    }

    /**
     * @param string   $code     Code à vérifier, en majuscules.
     * @param int|null $exceptId Code promo à ignorer (celui qu'on modifie), ou null.
     *
     * @return bool true si un autre code promo porte déjà ce code.
     */
    public function codeExists(string $code, ?int $exceptId): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT 1 FROM promo_code WHERE code = :code AND id <> :except LIMIT 1'
        );
        $statement->bindValue(':code', $code);
        $statement->bindValue(':except', $exceptId ?? 0, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchColumn() !== false;
    }

    /**
     * Crée un code promo, encore jamais utilisé.
     *
     * @param array{code:string, discountRate:int, minAmount:string, startsOn:?string, endsOn:?string,
     *              maxUses:?int} $promoCode Saisie déjà validée.
     *
     * @return int|null Identifiant du code créé, ou null si le code a été pris
     *                  entre-temps (clé unique).
     */
    public function create(array $promoCode): ?int
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO promo_code (code, discount_rate, min_amount, starts_on, ends_on, max_uses)
             VALUES (:code, :rate, :amount, :starts, :ends, :max)'
        );
        self::bindValues($statement, $promoCode);

        try {
            $statement->execute();
        } catch (PDOException $e) {
            if ($e->getCode() === self::INTEGRITY_VIOLATION) {
                return null;
            }
            throw $e;
        }

        return (int) $this->pdo->lastInsertId();
    }

    /**
     * Modifie un code promo. Le nombre d'utilisations déjà faites ne change pas.
     *
     * @param int $id
     * @param array{code:string, discountRate:int, minAmount:string, startsOn:?string, endsOn:?string,
     *              maxUses:?int} $promoCode Saisie déjà validée.
     *
     * @return bool false si le code a été pris entre-temps (clé unique).
     */
    public function update(int $id, array $promoCode): bool
    {
        $statement = $this->pdo->prepare(
            'UPDATE promo_code
                SET code = :code, discount_rate = :rate, min_amount = :amount,
                    starts_on = :starts, ends_on = :ends, max_uses = :max
              WHERE id = :id'
        );
        self::bindValues($statement, $promoCode);
        $statement->bindValue(':id', $id, PDO::PARAM_INT);

        try {
            $statement->execute();
        } catch (PDOException $e) {
            if ($e->getCode() === self::INTEGRITY_VIOLATION) {
                return false;
            }
            throw $e;
        }

        return true;
    }

    /**
     * Supprime un code promo.
     *
     * @param int $id
     */
    public function delete(int $id): void
    {
        $statement = $this->pdo->prepare('DELETE FROM promo_code WHERE id = :id');
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
    }

    /**
     * Lie les marqueurs :code, :rate, :amount, :starts, :ends et :max.
     *
     * @param PDOStatement $statement
     * @param array{code:string, discountRate:int, minAmount:string, startsOn:?string, endsOn:?string,
     *              maxUses:?int} $promoCode
     */
    private static function bindValues(PDOStatement $statement, array $promoCode): void
    {
        $statement->bindValue(':code', $promoCode['code']);
        $statement->bindValue(':rate', $promoCode['discountRate'], PDO::PARAM_INT);
        $statement->bindValue(':amount', $promoCode['minAmount']);
        $statement->bindValue(':starts', $promoCode['startsOn'], $promoCode['startsOn'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $statement->bindValue(':ends', $promoCode['endsOn'], $promoCode['endsOn'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $statement->bindValue(':max', $promoCode['maxUses'], $promoCode['maxUses'] === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
    }

    /**
     * Convertit une ligne SQL en code promo typé (MySQL renvoie les nombres
     * sous forme de chaînes).
     *
     * @param array{id:string, code:string, discount_rate:string, min_amount:string, starts_on:?string,
     *              ends_on:?string, max_uses:?string, use_count:string} $row
     *
     * @return array{id:int, code:string, discountRate:int, minAmount:float, startsOn:?string,
     *               endsOn:?string, maxUses:?int, useCount:int}
     *         startsOn et endsOn au format « 2026-12-31 ».
     */
    private static function toPromoCode(array $row): array
    {
        return [
            'id'           => (int) $row['id'],
            'code'         => $row['code'],
            'discountRate' => (int) $row['discount_rate'],
            'minAmount'    => (float) $row['min_amount'],
            'startsOn'     => $row['starts_on'],
            'endsOn'       => $row['ends_on'],
            'maxUses'      => $row['max_uses'] === null ? null : (int) $row['max_uses'],
            'useCount'     => (int) $row['use_count'],
        ];
    }
}
