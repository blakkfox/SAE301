<?php

declare(strict_types=1);

namespace App\Model;

use PDO;
use PDOException;
use PDOStatement;
use Throwable;

/**
 * Accès aux produits du catalogue, et à leur gestion au back-office (US GOF-a).
 *
 * Cette couche ne contient aucune règle métier et ne décide de rien :
 * elle exécute les requêtes qu'on lui demande et renvoie des tableaux typés.
 */
final class ProductModel
{
    /**
     * Condition SQL d'un produit visible : actif, doté d'au moins une
     * variante (sans variante, il n'aurait ni référence ni stock), et rangé
     * dans une catégorie visible dont la parente, s'il y en a une, est
     * visible aussi (US GOF-c).
     * Écrite une seule fois pour que la liste, la fiche, les suggestions et
     * les compteurs de catégories (CategoryModel) montrent toujours les mêmes
     * produits. Les alias shown et shown_parent évitent toute confusion avec
     * la table category d'une requête appelante.
     */
    public const VISIBLE = 'product.is_active = 1
        AND EXISTS (SELECT 1 FROM variant WHERE variant.product_id = product.id)
        AND EXISTS (SELECT 1 FROM category AS shown
                 LEFT JOIN category AS shown_parent ON shown_parent.id = shown.parent_id
                     WHERE shown.id = product.category_id
                       AND shown.is_visible = 1
                       AND (shown_parent.id IS NULL OR shown_parent.is_visible = 1))';

    /**
     * Libellé complet d'une variante (US OPT-b) : le type de variante du
     * produit suivi du libellé de la variante, « Taille M » pour « M ».
     * CONCAT_WS ignore un type NULL : une variante unique garde son libellé
     * (« Unique », « 1 L »). Partagé avec OrderModel, qui le copie dans la
     * ligne de commande. La requête doit joindre variant et product.
     */
    public const VARIANT_LABEL = "CONCAT_WS(' ', product.variant_axis, variant.label)";

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

    /** Réduction de la promotion automatique (US PRO-c), en pour cent du prix du produit. */
    public const PROMO_RATE = 20;

    /**
     * Sous-requête SQL de l'identifiant du produit en promotion automatique
     * (US PRO-c) : le produit visible au plus grand stock total, le plus
     * petit id en cas d'égalité ; NULL si aucun produit visible n'a de stock.
     * Recalculée à chaque requête : la promotion suit les ventes et les
     * réassorts.
     * Le FROM product interne masque la table product de la requête
     * appelante : VISIBLE et IN_STOCK y désignent bien le candidat.
     */
    public const PROMOTED_ID = '(SELECT product.id
                  FROM product
                 WHERE ' . self::VISIBLE . ' AND ' . self::IN_STOCK . '
              ORDER BY (SELECT SUM(variant.stock) FROM variant WHERE variant.product_id = product.id) DESC,
                       product.id
                 LIMIT 1)';

    /** Code SQLSTATE d'une contrainte d'unicité violée (référence ou libellé déjà pris). */
    private const INTEGRITY_VIOLATION = '23000';

    /** Connexion à la base, fournie à la construction. */
    private PDO $pdo;

    /** Journal des stocks : la saisie du stock au back-office y est inscrite (US GOF-a). */
    private StockModel $stock;

    /**
     * @param PDO        $pdo   Connexion ouverte par Database::connexion().
     * @param StockModel $stock Mise à jour du stock, sur la même connexion (même transaction).
     */
    public function __construct(PDO $pdo, StockModel $stock)
    {
        $this->pdo   = $pdo;
        $this->stock = $stock;
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
     * @return array<int, array{id:int, name:string, price:float, originalPrice:?float, discountRate:?int,
     *                          image:?string, variantId:?int, stock:int,
     *                          lowStockThreshold:int}>
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
        $sql = 'SELECT product.id, product.name, product.price, product.image, product.low_stock_threshold, '
                     . self::SINGLE_VARIANT . ', ' . self::TOTAL_STOCK . ', ' . self::promotionColumns() . '
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
     * @return array{id:int, name:string, description:?string, price:float, originalPrice:?float,
     *               discountRate:?int, image:?string,
     *               variantAxis:?string, lowStockThreshold:int,
     *               category:array{id:int, name:string, slug:string,
     *                              parent:?array{id:int, name:string, slug:string}}}|null
     *         null si le produit n'existe pas ou n'est pas visible ;
     *         variantAxis : ce qui distingue ses variantes (« Taille »…), ou null (US OPT-b) ;
     *         lowStockThreshold : seuil « Bientôt épuisé » du produit (US GOF-a) ;
     *         price, originalPrice, discountRate : voir self::toPrices() (US PRO-c).
     */
    public function findVisibleById(int $id): ?array
    {
        // LEFT JOIN : une catégorie de premier niveau n'a pas de parent, et le
        // produit doit tout de même être trouvé.
        $sql = 'SELECT product.id, product.name, product.description, product.price, product.image,
                       product.variant_axis, product.low_stock_threshold, ' . self::promotionColumns() . ',
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
        ] + self::toPrices($row) + [
            'image'       => $row['image'],
            'variantAxis' => $row['variant_axis'],
            // Seuil « Bientôt épuisé » du produit (US GOF-a).
            'lowStockThreshold' => (int) $row['low_stock_threshold'],
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
     * il est revérifié par le serveur à la commande (CMD-a). Le libellé est
     * court (« M ») : la fiche l'affiche sous le type de variante du produit.
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
     * Options à cocher sur la fiche d'un produit (US OPT-c), dans l'ordre
     * d'affichage. Le supplément est renvoyé pour son affichage ; il est
     * relu en base à la commande (OPT-a, OrderModel), jamais pris au navigateur.
     *
     * @param int $productId Identifiant du produit.
     *
     * @return array<int, array{id:int, label:string, description:?string, price:float}>
     */
    public function findOptions(int $productId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, label, description, price
               FROM product_option
              WHERE product_id = :product
           ORDER BY position, id'
        );
        $statement->bindValue(':product', $productId, PDO::PARAM_INT);
        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'id'          => (int) $row['id'],
                'label'       => $row['label'],
                'description' => $row['description'],
                'price'       => (float) $row['price'],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Options de plusieurs produits à la fois, pour le panier (US OPT-a) :
     * une seule requête, quel que soit le nombre de produits.
     *
     * @param array<int, int> $productIds Identifiants de produits, liste indexée à partir de 0.
     *
     * @return array<int, array<int, array{id:int, label:string, description:?string, price:float}>>
     *         Clé : identifiant du produit ; un produit sans option est absent.
     */
    public function findOptionsByProducts(array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }

        // Un marqueur par identifiant, comme findCartVariants.
        $markers = array_map(
            static fn (int $index): string => ':p' . $index,
            array_keys($productIds),
        );

        $statement = $this->pdo->prepare(
            'SELECT id, product_id, label, description, price
               FROM product_option
              WHERE product_id IN (' . implode(', ', $markers) . ')
           ORDER BY product_id, position, id'
        );

        for ($i = 0; $i < count($productIds); $i++) {
            $statement->bindValue($markers[$i], $productIds[$i], PDO::PARAM_INT);
        }

        $statement->execute();
        $rows = $statement->fetchAll();

        $options = [];

        for ($i = 0; $i < count($rows); $i++) {
            $options[(int) $rows[$i]['product_id']][] = [
                'id'          => (int) $rows[$i]['id'],
                'label'       => $rows[$i]['label'],
                'description' => $rows[$i]['description'],
                'price'       => (float) $rows[$i]['price'],
            ];
        }

        return $options;
    }

    /**
     * Produits à suggérer sur une fiche : ceux de la même catégorie d'abord,
     * complétés par les autres, sans le produit affiché.
     *
     * @param int $productId  Produit affiché, à exclure.
     * @param int $categoryId Catégorie du produit affiché.
     * @param int $limit      Nombre de suggestions.
     *
     * @return array<int, array{id:int, name:string, price:float, originalPrice:?float, discountRate:?int,
     *                          image:?string, variantId:?int, stock:int,
     *                          lowStockThreshold:int}>
     */
    public function findRelated(int $productId, int $categoryId, int $limit): array
    {
        // « product.category_id = :category » vaut 1 ou 0 : trié en DESC, il
        // place la même catégorie en tête.
        $sql = 'SELECT product.id, product.name, product.price, product.image, product.low_stock_threshold, '
                     . self::SINGLE_VARIANT . ', ' . self::TOTAL_STOCK . ', ' . self::promotionColumns() . '
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
     * Le prix vient toujours de la base, jamais du navigateur : remisé si le
     * produit est en promotion (US PRO-c, voir self::toPrices()). Le stock sert
     * aux contraintes du panier (US STK-c) ; il est revérifié à la commande.
     *
     * @param array<int, int> $variantIds Identifiants de variantes, déjà validés
     *                                    par le contrôleur (entiers > 0, sans doublon).
     *
     * @return array<int, array{variantId:int, label:string, reference:string,
     *                          productId:int, name:string, price:float, originalPrice:?float,
     *                          discountRate:?int, image:?string, stock:int,
     *                          lowStockThreshold:int}>
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

        $sql = 'SELECT variant.id AS variant_id, ' . self::VARIANT_LABEL . ' AS label,
                       variant.reference, variant.stock,
                       product.id, product.name, product.price, product.image, product.low_stock_threshold,
                       ' . self::promotionColumns() . '
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
            ] + self::toPrices($row) + [
                'image'     => $row['image'],
                'stock'     => (int) $row['stock'],
                'lowStockThreshold' => (int) $row['low_stock_threshold'],
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
     * Variantes de produits visibles dont le stock est au plus le seuil
     * « Bientôt épuisé » de leur produit (US GOF-a) : les « Alertes stock »
     * du back-office (US GOF-b). Les épuisées d'abord.
     *
     * @return array<int, array{variantId:int, productId:int, name:string, label:string, stock:int,
     *                          lowStockThreshold:int}>
     */
    public function findLowStockVariants(): array
    {
        $sql = 'SELECT variant.id AS variant_id, ' . self::VARIANT_LABEL . ' AS label,
                       variant.stock, product.id, product.name, product.low_stock_threshold
                  FROM variant
            INNER JOIN product ON product.id = variant.product_id
                 WHERE variant.stock <= product.low_stock_threshold
                   AND ' . self::VISIBLE . '
              ORDER BY variant.stock, product.name, variant.position, variant.id';

        return array_map(
            static fn (array $row): array => [
                'variantId'         => (int) $row['variant_id'],
                'productId'         => (int) $row['id'],
                'name'              => $row['name'],
                'label'             => $row['label'],
                'stock'             => (int) $row['stock'],
                'lowStockThreshold' => (int) $row['low_stock_threshold'],
            ],
            $this->pdo->query($sql)->fetchAll(),
        );
    }

    /**
     * Tous les produits, en ligne ou non, pour la liste du back-office (US
     * GOF-a), par ordre alphabétique.
     *
     * @return array<int, array{id:int, name:string, price:float, image:?string, isActive:bool,
     *                          category:string, variantCount:int, stock:int, minStock:int,
     *                          lowStockThreshold:int}>
     *         stock : stock total ; minStock : stock de la variante la plus
     *         basse, qui donne l'état du produit (0 s'il n'a pas de variante).
     */
    public function findAdminList(): array
    {
        $sql = 'SELECT product.id, product.name, product.price, product.image, product.is_active,
                       product.low_stock_threshold, category.name AS category_name,
                       (SELECT COUNT(*) FROM variant WHERE variant.product_id = product.id) AS variant_count,
                       ' . self::TOTAL_STOCK . ',
                       (SELECT COALESCE(MIN(variant.stock), 0)
                          FROM variant
                         WHERE variant.product_id = product.id) AS min_stock
                  FROM product
            INNER JOIN category ON category.id = product.category_id
              ORDER BY product.name, product.id';

        return array_map(
            static fn (array $row): array => [
                'id'                => (int) $row['id'],
                'name'              => $row['name'],
                'price'             => (float) $row['price'],
                'image'             => $row['image'],
                'isActive'          => (int) $row['is_active'] === 1,
                'category'          => $row['category_name'],
                'variantCount'      => (int) $row['variant_count'],
                'stock'             => (int) $row['stock'],
                'minStock'          => (int) $row['min_stock'],
                'lowStockThreshold' => (int) $row['low_stock_threshold'],
            ],
            $this->pdo->query($sql)->fetchAll(),
        );
    }

    /**
     * Un produit, en ligne ou non, pour sa fiche au back-office (US GOF-a).
     * Ses variantes et options se lisent avec findVariants et findOptions.
     *
     * @param int $id Identifiant du produit.
     *
     * @return array{id:int, categoryId:int, name:string, description:?string, price:float,
     *               image:?string, variantAxis:?string, lowStockThreshold:int, isActive:bool}|null
     *         null si le produit n'existe pas.
     */
    public function findAdminById(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, category_id, name, description, price, image, variant_axis,
                    low_stock_threshold, is_active
               FROM product
              WHERE id = :id'
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();

        $row = $statement->fetch();

        if ($row === false) {
            return null;
        }

        return [
            'id'                => (int) $row['id'],
            'categoryId'        => (int) $row['category_id'],
            'name'              => $row['name'],
            'description'       => $row['description'],
            'price'             => (float) $row['price'],
            'image'             => $row['image'],
            'variantAxis'       => $row['variant_axis'],
            'lowStockThreshold' => (int) $row['low_stock_threshold'],
            'isActive'          => (int) $row['is_active'] === 1,
        ];
    }

    /**
     * Derniers mouvements de stock des variantes d'un produit (journal de
     * STK-a), du plus récent au plus ancien.
     *
     * @param int $productId Identifiant du produit.
     * @param int $limit     Nombre de mouvements.
     *
     * @return array<int, array{createdAt:string, reason:string, quantity:int, stockAfter:int,
     *                          orderId:?int, label:string}>
     *         reason : « commande », « annulation », « reassort » ou « ajustement » ;
     *         label : libellé court de la variante (« M »).
     */
    public function findMovements(int $productId, int $limit): array
    {
        $statement = $this->pdo->prepare(
            'SELECT stock_movement.created_at, stock_movement.reason, stock_movement.quantity,
                    stock_movement.stock_after, stock_movement.order_id, variant.label
               FROM stock_movement
         INNER JOIN variant ON variant.id = stock_movement.variant_id
              WHERE variant.product_id = :product
           ORDER BY stock_movement.created_at DESC, stock_movement.id DESC
              LIMIT :limit'
        );
        $statement->bindValue(':product', $productId, PDO::PARAM_INT);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'createdAt'  => $row['created_at'],
                'reason'     => $row['reason'],
                'quantity'   => (int) $row['quantity'],
                'stockAfter' => (int) $row['stock_after'],
                'orderId'    => $row['order_id'] === null ? null : (int) $row['order_id'],
                'label'      => $row['label'],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * @param string $slug
     *
     * @return bool true si un produit porte déjà ce slug.
     */
    public function slugExists(string $slug): bool
    {
        $statement = $this->pdo->prepare('SELECT 1 FROM product WHERE slug = :slug LIMIT 1');
        $statement->bindValue(':slug', $slug);
        $statement->execute();

        return $statement->fetchColumn() !== false;
    }

    /**
     * Références déjà portées par une variante d'un autre produit : la
     * référence est unique dans tout le catalogue.
     *
     * @param array<int, string> $references Références saisies, liste indexée à partir de 0.
     * @param int|null           $productId  Produit enregistré (ses propres variantes ne
     *                                       comptent pas), ou null à la création.
     *
     * @return array<int, string> Les références déjà prises.
     */
    public function findTakenReferences(array $references, ?int $productId): array
    {
        if ($references === []) {
            return [];
        }

        // Un marqueur par référence, comme findCartVariants.
        $markers = array_map(
            static fn (int $index): string => ':r' . $index,
            array_keys($references),
        );

        $statement = $this->pdo->prepare(
            'SELECT reference FROM variant WHERE reference IN (' . implode(', ', $markers) . ')'
            . ($productId === null ? '' : ' AND product_id <> :product')
        );

        for ($i = 0; $i < count($references); $i++) {
            $statement->bindValue($markers[$i], $references[$i]);
        }
        if ($productId !== null) {
            $statement->bindValue(':product', $productId, PDO::PARAM_INT);
        }

        $statement->execute();

        return $statement->fetchAll(PDO::FETCH_COLUMN);
    }

    /**
     * Variantes d'un produit présentes dans une commande « en cours » ou
     * « disponible » : elles ne peuvent pas être retirées, ni leur produit
     * supprimé, tant que la commande n'est pas retirée ou annulée (son
     * annulation doit pouvoir recréditer le stock).
     *
     * @param int $productId Identifiant du produit.
     *
     * @return array<int, int> Identifiants des variantes concernées.
     */
    public function findVariantsInOpenOrders(int $productId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT DISTINCT variant.id
               FROM variant
         INNER JOIN order_line ON order_line.variant_id = variant.id
         INNER JOIN customer_order ON customer_order.id = order_line.order_id
              WHERE variant.product_id = :product
                AND customer_order.status IN (\'en_cours\', \'disponible\')'
        );
        $statement->bindValue(':product', $productId, PDO::PARAM_INT);
        $statement->execute();

        return array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
    }

    /**
     * Crée un produit avec ses variantes et ses options (US GOF-a), dans une
     * transaction : le stock initial de chaque variante est inscrit au
     * journal comme un réassort.
     *
     * @param array{categoryId:int, name:string, description:?string, price:string, image:?string,
     *              variantAxis:?string, lowStockThreshold:int, isActive:bool,
     *              variants:array<int, array{id:?int, label:string, reference:string, stockDelta:int}>,
     *              options:array<int, array{id:?int, label:string, description:?string, price:string}>} $product
     *        Saisie déjà validée par le contrôleur (variantes et options sans id).
     * @param string $slug Slug libre, calculé par le contrôleur.
     *
     * @return int|null L'identifiant du produit créé, ou null si une
     *                  référence ou un libellé est déjà pris (rien n'est enregistré).
     */
    public function create(array $product, string $slug): ?int
    {
        $this->pdo->beginTransaction();

        try {
            $statement = $this->pdo->prepare(
                'INSERT INTO product (category_id, name, slug, description, price, image, variant_axis,
                                      low_stock_threshold, is_active)
                 VALUES (:category, :name, :slug, :description, :price, :image, :axis, :threshold, :active)'
            );
            self::bindProduct($statement, $product);
            $statement->bindValue(':slug', $slug);
            $statement->execute();

            $id = (int) $this->pdo->lastInsertId();

            $this->saveVariants($id, $product['variants']);
            $this->saveOptions($id, $product['options']);

            $this->pdo->commit();
        } catch (PDOException $e) {
            $this->pdo->rollBack();
            if ($e->getCode() === self::INTEGRITY_VIOLATION) {
                return null;
            }
            throw $e;
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return $id;
    }

    /**
     * Enregistre un produit, ses variantes et ses options (US GOF-a), dans
     * une transaction. Les variantes et options absentes de la saisie sont
     * supprimées, celles sans id sont créées. Le stock d'une variante reçoit
     * l'écart saisi (StockModel::adjust), jamais une valeur absolue.
     *
     * @param int   $id      Produit existant.
     * @param array $product Saisie déjà validée, comme pour create() ; les id
     *                       des variantes et options appartiennent au produit.
     *
     * @return bool false si une référence ou un libellé est déjà pris (rien
     *              n'est enregistré).
     */
    public function update(int $id, array $product): bool
    {
        $this->pdo->beginTransaction();

        try {
            $statement = $this->pdo->prepare(
                'UPDATE product
                    SET category_id = :category, name = :name, description = :description, price = :price,
                        image = :image, variant_axis = :axis, low_stock_threshold = :threshold,
                        is_active = :active
                  WHERE id = :id'
            );
            self::bindProduct($statement, $product);
            $statement->bindValue(':id', $id, PDO::PARAM_INT);
            $statement->execute();

            // Suppressions d'abord : une variante créée peut reprendre le
            // libellé ou la référence d'une variante retirée.
            $this->deleteMissing('variant', $id, array_column($product['variants'], 'id'));
            $this->deleteMissing('product_option', $id, array_column($product['options'], 'id'));

            $this->saveVariants($id, $product['variants']);
            $this->saveOptions($id, $product['options']);

            $this->pdo->commit();
        } catch (PDOException $e) {
            $this->pdo->rollBack();
            if ($e->getCode() === self::INTEGRITY_VIOLATION) {
                return false;
            }
            throw $e;
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }

        return true;
    }

    /**
     * Supprime un produit. Ses variantes, caractéristiques, options et leur
     * journal de stock partent avec lui (ON DELETE CASCADE) ; les lignes de
     * commande gardent leur copie du nom et du prix (variant_id à NULL).
     *
     * @param int $id Identifiant du produit.
     *
     * @return bool false si le produit n'existait plus.
     */
    public function delete(int $id): bool
    {
        $statement = $this->pdo->prepare('DELETE FROM product WHERE id = :id');
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();

        return $statement->rowCount() > 0;
    }

    /**
     * Crée ou modifie les variantes d'un produit, dans l'ordre reçu, et
     * applique à leur stock l'écart saisi. Appelée dans la transaction de
     * create() ou update().
     *
     * @param int                                                                            $productId
     * @param array<int, array{id:?int, label:string, reference:string, stockDelta:int}> $variants
     */
    private function saveVariants(int $productId, array $variants): void
    {
        $insert = $this->pdo->prepare(
            'INSERT INTO variant (product_id, reference, label, stock, position)
             VALUES (:product, :reference, :label, 0, :position)'
        );
        $update = $this->pdo->prepare(
            'UPDATE variant SET reference = :reference, label = :label, position = :position
              WHERE id = :id AND product_id = :product'
        );

        for ($i = 0; $i < count($variants); $i++) {
            $statement = $variants[$i]['id'] === null ? $insert : $update;

            $statement->bindValue(':product', $productId, PDO::PARAM_INT);
            $statement->bindValue(':reference', $variants[$i]['reference']);
            $statement->bindValue(':label', $variants[$i]['label']);
            $statement->bindValue(':position', $i + 1, PDO::PARAM_INT);
            if ($variants[$i]['id'] !== null) {
                $statement->bindValue(':id', $variants[$i]['id'], PDO::PARAM_INT);
            }
            $statement->execute();

            // Une variante créée part de 0 : son stock initial est un réassort.
            $variantId = $variants[$i]['id'] ?? (int) $this->pdo->lastInsertId();
            if ($variants[$i]['stockDelta'] !== 0) {
                $this->stock->adjust($variantId, $variants[$i]['stockDelta']);
            }
        }
    }

    /**
     * Crée ou modifie les options d'un produit (US OPT-c), dans l'ordre reçu.
     * Appelée dans la transaction de create() ou update().
     *
     * @param int                                                                            $productId
     * @param array<int, array{id:?int, label:string, description:?string, price:string}> $options
     */
    private function saveOptions(int $productId, array $options): void
    {
        $insert = $this->pdo->prepare(
            'INSERT INTO product_option (product_id, label, description, price, position)
             VALUES (:product, :label, :description, :price, :position)'
        );
        $update = $this->pdo->prepare(
            'UPDATE product_option SET label = :label, description = :description, price = :price, position = :position
              WHERE id = :id AND product_id = :product'
        );

        for ($i = 0; $i < count($options); $i++) {
            $statement = $options[$i]['id'] === null ? $insert : $update;

            $statement->bindValue(':product', $productId, PDO::PARAM_INT);
            $statement->bindValue(':label', $options[$i]['label']);
            $statement->bindValue(
                ':description',
                $options[$i]['description'],
                $options[$i]['description'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR,
            );
            $statement->bindValue(':price', $options[$i]['price']);
            $statement->bindValue(':position', $i + 1, PDO::PARAM_INT);
            if ($options[$i]['id'] !== null) {
                $statement->bindValue(':id', $options[$i]['id'], PDO::PARAM_INT);
            }
            $statement->execute();
        }
    }

    /**
     * Supprime les lignes d'un produit absentes de la saisie.
     *
     * @param string               $table     « variant » ou « product_option » : jamais une
     *                                        valeur reçue, seulement ces deux constantes.
     * @param int                  $productId
     * @param array<int, int|null> $keptIds   Identifiants saisis (null : ligne à créer).
     */
    private function deleteMissing(string $table, int $productId, array $keptIds): void
    {
        $keptIds = array_values(array_filter($keptIds, static fn (?int $id): bool => $id !== null));
        $markers = array_map(
            static fn (int $index): string => ':k' . $index,
            array_keys($keptIds),
        );

        $statement = $this->pdo->prepare(
            "DELETE FROM {$table} WHERE product_id = :product"
            . ($keptIds === [] ? '' : ' AND id NOT IN (' . implode(', ', $markers) . ')')
        );
        $statement->bindValue(':product', $productId, PDO::PARAM_INT);
        for ($i = 0; $i < count($keptIds); $i++) {
            $statement->bindValue($markers[$i], $keptIds[$i], PDO::PARAM_INT);
        }
        $statement->execute();
    }

    /**
     * Lie les colonnes du produit aux marqueurs de create() et update().
     *
     * @param PDOStatement         $statement
     * @param array<string, mixed> $product   Saisie validée.
     */
    private static function bindProduct(PDOStatement $statement, array $product): void
    {
        $statement->bindValue(':category', $product['categoryId'], PDO::PARAM_INT);
        $statement->bindValue(':name', $product['name']);
        $statement->bindValue(
            ':description',
            $product['description'],
            $product['description'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR,
        );
        $statement->bindValue(':price', $product['price']);
        $statement->bindValue(':image', $product['image'], $product['image'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $statement->bindValue(':axis', $product['variantAxis'], $product['variantAxis'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $statement->bindValue(':threshold', $product['lowStockThreshold'], PDO::PARAM_INT);
        $statement->bindValue(':active', $product['isActive'] ? 1 : 0, PDO::PARAM_INT);
    }

    /**
     * Le produit en promotion automatique (US PRO-c), pour le bandeau du site.
     *
     * @return array{id:int, name:string, price:float, originalPrice:?float, discountRate:?int}|null
     *         null si aucun produit n'est en promotion ; price est le prix remisé.
     */
    public function findPromotion(): ?array
    {
        $row = $this->pdo->query(
            'SELECT product.id, product.name, product.price, ' . self::promotionColumns() . '
               FROM product
              WHERE product.id = ' . self::PROMOTED_ID
        )->fetch();

        if ($row === false) {
            return null;
        }

        return ['id' => (int) $row['id'], 'name' => $row['name']] + self::toPrices($row);
    }

    /**
     * Expression SQL du prix payé d'un produit (US PRO-c) : son prix, diminué
     * de PROMO_RATE % s'il est le produit en promotion, arrondi au centime.
     * La requête doit joindre product.
     *
     * @param string $promotedId Expression SQL de l'identifiant du produit en
     *                           promotion : self::PROMOTED_ID, ou un marqueur
     *                           lié (OrderModel, qui le lit avant de baisser le stock).
     *
     * @return string Le fragment SQL.
     */
    public static function salePrice(string $promotedId): string
    {
        return 'ROUND(product.price * IF(product.id <=> ' . $promotedId . ', '
            . (100 - self::PROMO_RATE) . ' / 100, 1), 2)';
    }

    /**
     * Colonnes SQL sale_price et is_promoted d'un produit (US PRO-c), lues
     * par self::toPrices(). La requête doit joindre product.
     *
     * @return string Le fragment SQL.
     */
    private static function promotionColumns(): string
    {
        return self::salePrice(self::PROMOTED_ID) . ' AS sale_price, product.id <=> '
            . self::PROMOTED_ID . ' AS is_promoted';
    }

    /**
     * Prix d'un produit tels que l'API les renvoie (US PRO-c).
     *
     * @param array{price:string, sale_price:string, is_promoted:string} $row Ligne lue avec
     *                                                                         self::promotionColumns().
     *
     * @return array{price:float, originalPrice:?float, discountRate:?int}
     *         price : le prix à payer, remisé si le produit est en promotion ;
     *         originalPrice : le prix avant remise, ou null sans promotion ;
     *         discountRate : la réduction en pour cent, ou null sans promotion.
     */
    private static function toPrices(array $row): array
    {
        $isPromoted = (int) $row['is_promoted'] === 1;

        return [
            'price'         => (float) $row['sale_price'],
            'originalPrice' => $isPromoted ? (float) $row['price'] : null,
            'discountRate'  => $isPromoted ? self::PROMO_RATE : null,
        ];
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
     * @param array{id:string, name:string, price:string, sale_price:string, is_promoted:string,
     *              image:?string, low_stock_threshold:string, single_variant_id:?string, stock:string} $row
     *
     * @return array{id:int, name:string, price:float, originalPrice:?float, discountRate:?int,
     *                          image:?string, variantId:?int, stock:int,
     *               lowStockThreshold:int}
     *         variantId : la variante unique du produit, ou null s'il en a plusieurs ;
     *         stock : le stock total de ses variantes (US STK-b) ;
     *         lowStockThreshold : seuil « Bientôt épuisé » du produit (US GOF-a) ;
     *         price, originalPrice, discountRate : voir self::toPrices() (US PRO-c).
     */
    private static function toCard(array $row): array
    {
        return [
            'id'                => (int) $row['id'],
            'name'              => $row['name'],
        ] + self::toPrices($row) + [
            'image'             => $row['image'],
            'variantId'         => $row['single_variant_id'] === null ? null : (int) $row['single_variant_id'],
            'stock'             => (int) $row['stock'],
            'lowStockThreshold' => (int) $row['low_stock_threshold'],
        ];
    }
}
