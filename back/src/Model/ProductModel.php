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
    /**
     * Condition SQL d'un produit visible : actif, et doté d'au moins une
     * variante (sans variante, il n'aurait ni référence ni stock).
     * Écrite une seule fois pour que la liste, la fiche et les suggestions
     * montrent toujours les mêmes produits.
     */
    private const VISIBLE = 'product.is_active = 1
        AND EXISTS (SELECT 1 FROM variant WHERE variant.product_id = product.id)';

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
     * @return int Nombre de produits visibles.
     */
    public function countVisible(): int
    {
        $sql = 'SELECT COUNT(*) FROM product WHERE ' . self::VISIBLE;

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
        $sql = 'SELECT product.id, product.name, product.price, product.image
                  FROM product
                 WHERE ' . self::VISIBLE . "
              ORDER BY {$orderBy}, product.id
                 LIMIT :limit OFFSET :offset";

        $statement = $this->pdo->prepare($sql);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        return array_map([self::class, 'toCard'], $statement->fetchAll());
    }

    /**
     * Un produit visible, avec sa catégorie.
     *
     * @param int $id Identifiant du produit.
     *
     * @return array{id:int, name:string, description:?string, price:float, image:?string,
     *               category:array{id:int, name:string, slug:string}}|null
     *         null si le produit n'existe pas ou n'est pas visible.
     */
    public function findVisibleById(int $id): ?array
    {
        $sql = 'SELECT product.id, product.name, product.description, product.price, product.image,
                       category.id   AS category_id,
                       category.name AS category_name,
                       category.slug AS category_slug
                  FROM product
            INNER JOIN category ON category.id = product.category_id
                 WHERE product.id = :id
                   AND ' . self::VISIBLE;

        $statement = $this->pdo->prepare($sql);
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();

        $row = $statement->fetch();

        if ($row === false) {
            return null;
        }

        return [
            'id'          => (int) $row['id'],
            'name'        => $row['name'],
            'description' => $row['description'],
            'price'       => (float) $row['price'],
            'image'       => $row['image'],
            'category'    => [
                'id'   => (int) $row['category_id'],
                'name' => $row['category_name'],
                'slug' => $row['category_slug'],
            ],
        ];
    }

    /**
     * Variantes d'un produit, dans l'ordre d'affichage.
     *
     * Le stock n'est pas renvoyé : son affichage relève de l'US STK-b.
     *
     * @param int $productId Identifiant du produit.
     *
     * @return array<int, array{id:int, label:string, reference:string}>
     */
    public function findVariants(int $productId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, label, reference
               FROM variant
              WHERE product_id = :product
           ORDER BY position, id'
        );
        $statement->bindValue(':product', $productId, PDO::PARAM_INT);
        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'id'        => (int) $row['id'],
                'label'     => $row['label'],
                'reference' => $row['reference'],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Caractéristiques d'un produit (« Matière : Cuir véritable »…).
     *
     * @param int $productId Identifiant du produit.
     *
     * @return array<int, array{label:string, value:string}>
     */
    public function findFeatures(int $productId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT label, value
               FROM product_feature
              WHERE product_id = :product
           ORDER BY position, id'
        );
        $statement->bindValue(':product', $productId, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchAll();
    }

    /**
     * Produits à suggérer sur une fiche : ceux de la même catégorie d'abord,
     * complétés par les autres, sans le produit affiché.
     *
     * @param int $productId  Produit affiché, à exclure.
     * @param int $categoryId Catégorie du produit affiché.
     * @param int $limit      Nombre de suggestions.
     *
     * @return array<int, array{id:int, name:string, price:float, image:?string}>
     */
    public function findRelated(int $productId, int $categoryId, int $limit): array
    {
        // « product.category_id = :category » vaut 1 ou 0 : trié en DESC, il
        // place la même catégorie en tête.
        $sql = 'SELECT product.id, product.name, product.price, product.image
                  FROM product
                 WHERE product.id <> :product
                   AND ' . self::VISIBLE . '
              ORDER BY product.category_id = :category DESC, product.id
                 LIMIT :limit';

        $statement = $this->pdo->prepare($sql);
        $statement->bindValue(':product', $productId, PDO::PARAM_INT);
        $statement->bindValue(':category', $categoryId, PDO::PARAM_INT);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();

        return array_map([self::class, 'toCard'], $statement->fetchAll());
    }

    /**
     * Convertit une ligne SQL en données de carte produit. MySQL renvoie
     * DECIMAL et les entiers sous forme de chaînes : on les type pour que le
     * JSON contienne de vrais nombres.
     *
     * @param array{id:string, name:string, price:string, image:?string} $row
     *
     * @return array{id:int, name:string, price:float, image:?string}
     */
    private static function toCard(array $row): array
    {
        return [
            'id'    => (int) $row['id'],
            'name'  => $row['name'],
            'price' => (float) $row['price'],
            'image' => $row['image'],
        ];
    }
}
