<?php

declare(strict_types=1);

namespace App\Model;

use PDO;

/**
 * Accès aux concessions de retrait (US CMD-a).
 *
 * Cette couche ne contient aucune règle métier : elle exécute les requêtes
 * qu'on lui demande et renvoie des tableaux typés.
 */
final class DealershipModel
{
    /** Colonnes renvoyées pour une concession. */
    private const COLUMNS = 'id, name, short_name, address, hours_label';

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
     * Toutes les concessions, dans l'ordre d'affichage.
     *
     * @return array<int, array{id:int, name:string, shortName:string, address:string, hoursLabel:string}>
     */
    public function findAll(): array
    {
        $statement = $this->pdo->query('SELECT ' . self::COLUMNS . ' FROM dealership ORDER BY position, id');

        return array_map([self::class, 'toDealership'], $statement->fetchAll());
    }

    /**
     * Une concession.
     *
     * @param int $id Identifiant de la concession.
     *
     * @return array{id:int, name:string, shortName:string, address:string, hoursLabel:string}|null
     *         null si la concession n'existe pas.
     */
    public function findById(int $id): ?array
    {
        $statement = $this->pdo->prepare('SELECT ' . self::COLUMNS . ' FROM dealership WHERE id = :id');
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();

        $row = $statement->fetch();

        return $row === false ? null : self::toDealership($row);
    }

    /**
     * Convertit une ligne SQL en concession, en camelCase et typée.
     *
     * @param array{id:string, name:string, short_name:string, address:string, hours_label:string} $row
     *
     * @return array{id:int, name:string, shortName:string, address:string, hoursLabel:string}
     */
    private static function toDealership(array $row): array
    {
        return [
            'id'         => (int) $row['id'],
            'name'       => $row['name'],
            'shortName'  => $row['short_name'],
            'address'    => $row['address'],
            'hoursLabel' => $row['hours_label'],
        ];
    }
}
