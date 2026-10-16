<?php

declare(strict_types=1);

namespace App\Model;

use PDO;

/**
 * Accès aux produits du catalogue.
 *
 * Cette couche ne contient aucune règle métier et ne décide de rien :
 * elle exécute les requêtes qu'on lui demande et renvoie des tableaux typés.
 */
final class ProductModel
{
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
     * Nombre de produits visibles dans le catalogue.
     *
     * Un produit n'est visible que s'il est actif et possède au moins une
     * variante : sans variante, il n'aurait ni référence ni stock.
     *
     * @return int Nombre de produits visibles.
     */
    public function countVisible(): int
    {
        $sql = 'SELECT COUNT(*)
                  FROM product
                 WHERE product.is_active = 1
                   AND EXISTS (SELECT 1 FROM variant WHERE variant.product_id = product.id)';

        return (int) $this->pdo->query($sql)->fetchColumn();
    }

    /**
     * Une page de produits visibles.
     *
     * @param string $orderBy Fragment SQL de tri, par exemple « product.price ASC ».
     *                        ATTENTION : ce fragment est inséré tel quel dans la
     *                        requête. Il ne doit JAMAIS provenir directement de
     *                        l'utilisateur — voir la liste blanche du contrôleur.
     * @param int    $limit   Nombre de produits à renvoyer.
     * @param int    $offset  Nombre de produits à sauter (pagination).
     *
     * @return array<int, array{id:int, name:string, price:float, image:?string}>
     */
    public function findVisiblePage(string $orderBy, int $limit, int $offset): array
    {
        // product.id en dernier critère : deux produits au même prix gardent
        // toujours le même ordre, sinon un produit pourrait apparaître sur
        // deux pages successives.
        $sql = "SELECT product.id,
                       product.name,
                       product.price,
                       product.image
                  FROM product
                 WHERE product.is_active = 1
                   AND EXISTS (SELECT 1 FROM variant WHERE variant.product_id = product.id)
              ORDER BY {$orderBy}, product.id
                 LIMIT :limit OFFSET :offset";

        $statement = $this->pdo->prepare($sql);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        // MySQL renvoie DECIMAL sous forme de chaîne : on convertit chaque ligne
        // pour que le JSON contienne de vrais nombres.
        return array_map(
            static fn (array $row): array => [
                'id'    => (int) $row['id'],
                'name'  => $row['name'],
                'price' => (float) $row['price'],
                'image' => $row['image'],
            ],
            $statement->fetchAll(),
        );
    }
}
