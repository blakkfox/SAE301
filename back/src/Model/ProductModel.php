<?php

declare(strict_types=1);

namespace App\Model;

use PDO;
use PDOStatement;

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
     * Écrite une seule fois pour que la liste, la fiche, les suggestions et
     * les compteurs de catégories (CategoryModel) montrent toujours les mêmes
     * produits.
     */
    public const VISIBLE = 'product.is_active = 1
        AND EXISTS (SELECT 1 FROM variant WHERE variant.product_id = product.id)';

    /**
     * Colonne SQL single_variant_id d'une carte produit : l'identifiant de la
     * variante si le produit n'en a qu'une, NULL sinon. Elle permet d'ajouter
     * au panier depuis la carte (CMD-b) sans avoir à choisir de variante.
     */
    private const SINGLE_VARIANT = '(SELECT IF(COUNT(*) = 1, MIN(variant.id), NULL)
                  FROM variant
                 WHERE variant.product_id = product.id) AS single_variant_id';

    /**
     * Colonne SQL stock d'une carte produit (US STK-b) : le stock total de ses
     * variantes. 0 signifie que le produit est épuisé dans toutes ses variantes.
     */
    private const TOTAL_STOCK = '(SELECT COALESCE(SUM(variant.stock), 0)
                  FROM variant
                 WHERE variant.product_id = product.id) AS stock';

    /**
     * Condition SQL « au moins une variante en stock », pour « Masquer les
     * produits épuisés » (US STK-b).
     */
    private const IN_STOCK = 'EXISTS (SELECT 1 FROM variant
        WHERE variant.product_id = product.id AND variant.stock > 0)';

    /**
     * Condition SQL « le produit est dans la catégorie :category, ou dans
     * l'une de ses sous-catégories ».
     * Un seul marqueur :category : PDO, sans émulation des requêtes préparées,
     * refuse qu'un même marqueur apparaisse deux fois.
     */
    private const IN_CATEGORY = 'product.category_id IN (
        SELECT category.id FROM category WHERE :category IN (category.id, category.parent_id))';

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
     * Nombre de produits visibles, dans tout le catalogue ou dans une catégorie.
     *
     * @param int|null $categoryId  Catégorie (sous-catégories comprises), ou
     *                              null pour tout le catalogue.
     * @param bool     $inStockOnly true pour ne compter que les produits dont
     *                              une variante au moins est en stock.
     *
     * @return int Nombre de produits visibles.
     */
    public function countVisible(?int $categoryId = null, bool $inStockOnly = false): int
    {
        $sql = 'SELECT COUNT(*) FROM product WHERE ' . self::VISIBLE
            . self::categoryFilter($categoryId) . self::stockFilter($inStockOnly);

        $statement = $this->pdo->prepare($sql);
        self::bindCategory($statement, $categoryId);
        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    /**
     * Une page de produits visibles, dans tout le catalogue ou dans une catégorie.
     *
     * @param string   $orderBy    Fragment SQL de tri, par exemple « product.price ASC ».
     *                             ATTENTION : ce fragment est inséré tel quel dans la
     *                             requête. Il ne doit JAMAIS provenir directement de
     *                             l'utilisateur — voir la liste blanche du contrôleur.
     * @param int      $limit      Nombre de produits à renvoyer.
     * @param int      $offset     Nombre de produits à sauter (pagination).
     * @param int|null $categoryId Catégorie (sous-catégories comprises), ou
     *                             null pour tout le catalogue.
     * @param bool     $inStockOnly true pour ne garder que les produits dont
     *                              une variante au moins est en stock.
     *
     * @return array<int, array{id:int, name:string, price:float, image:?string, variantId:?int, stock:int}>
     */
    public function findVisiblePage(
        string $orderBy,
        int $limit,
        int $offset,
        ?int $categoryId = null,
        bool $inStockOnly = false,
    ): array {
        // product.id en dernier critère : deux produits au même prix gardent
        // toujours le même ordre, sinon un produit pourrait apparaître sur
        // deux pages successives.
        $sql = 'SELECT product.id, product.name, product.price, product.image, '
                     . self::SINGLE_VARIANT . ', ' . self::TOTAL_STOCK . '
                  FROM product
                 WHERE ' . self::VISIBLE . self::categoryFilter($categoryId) . self::stockFilter($inStockOnly) . "
              ORDER BY {$orderBy}, product.id
                 LIMIT :limit OFFSET :offset";

        $statement = $this->pdo->prepare($sql);
        self::bindCategory($statement, $categoryId);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        return array_map([self::class, 'toCard'], $statement->fetchAll());
    }

    /**
     * Un produit visible, avec sa catégorie et la catégorie parente de
     * celle-ci (null pour une catégorie de premier niveau).
     *
     * @param int $id Identifiant du produit.
     *
     * @return array{id:int, name:string, description:?string, price:float, image:?string,
     *               category:array{id:int, name:string, slug:string,
     *                              parent:?array{id:int, name:string, slug:string}}}|null
     *         null si le produit n'existe pas ou n'est pas visible.
     */
    public function findVisibleById(int $id): ?array
    {
        // LEFT JOIN : une catégorie de premier niveau n'a pas de parent, et le
        // produit doit tout de même être trouvé.
        $sql = 'SELECT product.id, product.name, product.description, product.price, product.image,
                       category.id   AS category_id,
                       category.name AS category_name,
                       category.slug AS category_slug,
                       parent.id     AS parent_id,
                       parent.name   AS parent_name,
                       parent.slug   AS parent_slug
                  FROM product
            INNER JOIN category ON category.id = product.category_id
             LEFT JOIN category AS parent ON parent.id = category.parent_id
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
                'id'     => (int) $row['category_id'],
                'name'   => $row['category_name'],
                'slug'   => $row['category_slug'],
                'parent' => $row['parent_id'] === null ? null : [
                    'id'   => (int) $row['parent_id'],
                    'name' => $row['parent_name'],
                    'slug' => $row['parent_slug'],
                ],
            ],
        ];
    }

    /**
     * Variantes d'un produit, dans l'ordre d'affichage.
     *
     * Le stock de chaque variante est renvoyé pour son affichage (US STK-b) ;
     * il est revérifié par le serveur à la commande (CMD-a).
     *
     * @param int $productId Identifiant du produit.
     *
     * @return array<int, array{id:int, label:string, reference:string, stock:int}>
     */
    public function findVariants(int $productId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, label, reference, stock
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
                'stock'     => (int) $row['stock'],
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
     * @return array<int, array{id:int, name:string, price:float, image:?string, variantId:?int, stock:int}>
     */
    public function findRelated(int $productId, int $categoryId, int $limit): array
    {
        // « product.category_id = :category » vaut 1 ou 0 : trié en DESC, il
        // place la même catégorie en tête.
        $sql = 'SELECT product.id, product.name, product.price, product.image, '
                     . self::SINGLE_VARIANT . ', ' . self::TOTAL_STOCK . '
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
     * Variantes du panier (US CMD-b), avec le produit qui les porte.
     *
     * Seules les variantes d'un produit visible sont renvoyées : une variante
     * inconnue ou retirée du catalogue est simplement absente du résultat.
     * Le prix vient toujours de la base, jamais du navigateur. Le stock sert
     * aux contraintes du panier (US STK-c) ; il est revérifié à la commande.
     *
     * @param array<int, int> $variantIds Identifiants de variantes, déjà validés
     *                                    par le contrôleur (entiers > 0, sans doublon).
     *
     * @return array<int, array{variantId:int, label:string, reference:string,
     *                          productId:int, name:string, price:float, image:?string, stock:int}>
     */
    public function findCartVariants(array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }

        // Un marqueur par identifiant (:v0, :v1…) : seuls les NOMS des
        // marqueurs sont écrits dans la requête, jamais les valeurs reçues.
        $markers = array_map(
            static fn (int $index): string => ':v' . $index,
            array_keys($variantIds),
        );

        $sql = 'SELECT variant.id AS variant_id, variant.label, variant.reference, variant.stock,
                       product.id, product.name, product.price, product.image
                  FROM variant
            INNER JOIN product ON product.id = variant.product_id
                 WHERE variant.id IN (' . implode(', ', $markers) . ')
                   AND ' . self::VISIBLE;

        $statement = $this->pdo->prepare($sql);

        for ($i = 0; $i < count($variantIds); $i++) {
            $statement->bindValue($markers[$i], $variantIds[$i], PDO::PARAM_INT);
        }

        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'variantId' => (int) $row['variant_id'],
                'label'     => $row['label'],
                'reference' => $row['reference'],
                'productId' => (int) $row['id'],
                'name'      => $row['name'],
                'price'     => (float) $row['price'],
                'image'     => $row['image'],
                'stock'     => (int) $row['stock'],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Produits visibles épuisés dans toutes leurs variantes, pour le tableau
     * de bord du back-office (US GOF-b).
     *
     * @return array<int, array{id:int, name:string}> Par ordre alphabétique.
     */
    public function findSoldOut(): array
    {
        $sql = 'SELECT product.id, product.name
                  FROM product
                 WHERE ' . self::VISIBLE . '
                   AND NOT ' . self::IN_STOCK . '
              ORDER BY product.name, product.id';

        return array_map(
            static fn (array $row): array => ['id' => (int) $row['id'], 'name' => $row['name']],
            $this->pdo->query($sql)->fetchAll(),
        );
    }

    /**
     * Variantes de produits visibles dont le stock est au plus $maxStock :
     * les « Alertes stock » du back-office (US GOF-b). Les épuisées d'abord.
     *
     * @param int $maxStock Seuil d'alerte, compris.
     *
     * @return array<int, array{variantId:int, productId:int, name:string, label:string, stock:int}>
     */
    public function findLowStockVariants(int $maxStock): array
    {
        $statement = $this->pdo->prepare(
            'SELECT variant.id AS variant_id, variant.label, variant.stock, product.id, product.name
               FROM variant
         INNER JOIN product ON product.id = variant.product_id
              WHERE variant.stock <= :maxStock
                AND ' . self::VISIBLE . '
           ORDER BY variant.stock, product.name, variant.position, variant.id'
        );
        $statement->bindValue(':maxStock', $maxStock, PDO::PARAM_INT);
        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'variantId' => (int) $row['variant_id'],
                'productId' => (int) $row['id'],
                'name'      => $row['name'],
                'label'     => $row['label'],
                'stock'     => (int) $row['stock'],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Fragment SQL à ajouter après self::VISIBLE pour filtrer par catégorie.
     *
     * @param int|null $categoryId Catégorie, ou null pour ne pas filtrer.
     *
     * @return string Le fragment « AND … », ou une chaîne vide.
     */
    private static function categoryFilter(?int $categoryId): string
    {
        return $categoryId === null ? '' : ' AND ' . self::IN_CATEGORY;
    }

    /**
     * Fragment SQL à ajouter après self::VISIBLE pour ne garder que les
     * produits en stock.
     *
     * @param bool $inStockOnly true pour filtrer.
     *
     * @return string Le fragment « AND … », ou une chaîne vide.
     */
    private static function stockFilter(bool $inStockOnly): string
    {
        return $inStockOnly ? ' AND ' . self::IN_STOCK : '';
    }

    /**
     * Lie la catégorie au marqueur :category, si un filtre est demandé.
     *
     * @param PDOStatement $statement  Requête préparée avec self::categoryFilter().
     * @param int|null     $categoryId Catégorie, ou null pour ne pas filtrer.
     */
    private static function bindCategory(PDOStatement $statement, ?int $categoryId): void
    {
        if ($categoryId !== null) {
            $statement->bindValue(':category', $categoryId, PDO::PARAM_INT);
        }
    }

    /**
     * Convertit une ligne SQL en données de carte produit. MySQL renvoie
     * DECIMAL et les entiers sous forme de chaînes : on les type pour que le
     * JSON contienne de vrais nombres.
     *
     * @param array{id:string, name:string, price:string, image:?string, single_variant_id:?string,
     *              stock:string} $row
     *
     * @return array{id:int, name:string, price:float, image:?string, variantId:?int, stock:int}
     *         variantId : la variante unique du produit, ou null s'il en a plusieurs ;
     *         stock : le stock total de ses variantes (US STK-b).
     */
    private static function toCard(array $row): array
    {
        return [
            'id'        => (int) $row['id'],
            'name'      => $row['name'],
            'price'     => (float) $row['price'],
            'image'     => $row['image'],
            'variantId' => $row['single_variant_id'] === null ? null : (int) $row['single_variant_id'],
            'stock'     => (int) $row['stock'],
        ];
    }
}
