<?php

declare(strict_types=1);

namespace App\Model;

use PDO;
use PDOException;
use PDOStatement;

/**
 * Accès aux catégories du catalogue (US DEC-a) et à leur gestion au
 * back-office (US GOF-c).
 *
 * Comme ProductModel, cette couche exécute les requêtes et renvoie des
 * tableaux typés, sans rien décider.
 */
final class CategoryModel
{
    /**
     * Condition SQL d'une catégorie affichée dans la boutique (US GOF-c) :
     * visible, et dont la parente, s'il y en a une, est visible aussi. Même
     * règle que ProductModel::VISIBLE pour les produits.
     */
    private const SHOWN = 'category.is_visible = 1
        AND (category.parent_id IS NULL
             OR category.parent_id IN (SELECT parent.id FROM category AS parent WHERE parent.is_visible = 1))';

    /**
     * Colonne SQL product_count du back-office : TOUS les produits de la
     * catégorie et de ses sous-catégories, actifs ou non. C'est ce nombre qui
     * empêche la suppression (clé étrangère fk_product_category).
     */
    private const ALL_PRODUCT_COUNT = '(SELECT COUNT(*)
                          FROM product
                         WHERE product.category_id IN (
                               SELECT sub.id FROM category AS sub
                                WHERE category.id IN (sub.id, sub.parent_id))
                       ) AS product_count';

    /** Code SQLSTATE d'une contrainte violée (clé unique, clé étrangère). */
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
     * Identifiant d'une catégorie affichée dans la boutique à partir de son
     * slug (« collection-honda »).
     *
     * @param string $slug Slug lu dans l'adresse.
     *
     * @return int|null L'identifiant, ou null si aucune catégorie n'a ce slug
     *                  ou si elle est masquée (US GOF-c).
     */
    public function findIdBySlug(string $slug): ?int
    {
        $statement = $this->pdo->prepare('SELECT id FROM category WHERE slug = :slug AND ' . self::SHOWN);
        $statement->bindValue(':slug', $slug);
        $statement->execute();

        $id = $statement->fetchColumn();

        return $id === false ? null : (int) $id;
    }

    /**
     * Les catégories affichées dans la boutique, en arbre : les catégories de
     * premier niveau, chacune avec ses sous-catégories (children), dans
     * l'ordre d'affichage. Les catégories masquées n'y sont pas (US GOF-c).
     *
     * productCount compte les produits visibles de la catégorie ET de ses
     * sous-catégories, avec la même règle de visibilité que le catalogue.
     *
     * @return array<int, array{id:int, parentId:null, name:string, slug:string,
     *               description:?string, productCount:int,
     *               children:array<int, array{id:int, parentId:int, name:string, slug:string,
     *                                       description:?string, productCount:int}>}>
     */
    public function findTree(): array
    {
        // La sous-requête est corrélée : « category » y désigne la ligne de la
        // requête principale, « sub » ses sous-catégories et elle-même.
        $sql = 'SELECT category.id, category.parent_id, category.name, category.slug, category.description,
                       (SELECT COUNT(*)
                          FROM product
                         WHERE ' . ProductModel::VISIBLE . '
                           AND product.category_id IN (
                               SELECT sub.id FROM category AS sub
                                WHERE category.id IN (sub.id, sub.parent_id))
                       ) AS product_count
                  FROM category
                 WHERE ' . self::SHOWN . '
              ORDER BY category.position, category.id';

        return self::toTree(array_map([self::class, 'toCategory'], $this->pdo->query($sql)->fetchAll()));
    }

    /**
     * Toutes les catégories, masquées comprises, en arbre comme findTree,
     * pour le back-office (US GOF-c). productCount compte tous les produits,
     * actifs ou non (ALL_PRODUCT_COUNT).
     *
     * @return array<int, array{id:int, parentId:null, name:string, slug:string, description:?string,
     *               isVisible:bool, productCount:int,
     *               children:array<int, array{id:int, parentId:int, name:string, slug:string,
     *                                       description:?string, isVisible:bool, productCount:int}>}>
     */
    public function findAdminTree(): array
    {
        $sql = 'SELECT category.id, category.parent_id, category.name, category.slug, category.description,
                       category.is_visible, ' . self::ALL_PRODUCT_COUNT . '
                  FROM category
              ORDER BY category.position, category.id';

        return self::toTree(array_map([self::class, 'toAdminCategory'], $this->pdo->query($sql)->fetchAll()));
    }

    /**
     * Une catégorie, masquée ou non, pour le back-office (US GOF-c).
     *
     * @param int $id Identifiant de la catégorie.
     *
     * @return array{id:int, parentId:?int, name:string, slug:string, description:?string,
     *               isVisible:bool, productCount:int, childCount:int}|null
     *         null si la catégorie n'existe pas.
     */
    public function findById(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT category.id, category.parent_id, category.name, category.slug, category.description,
                    category.is_visible, ' . self::ALL_PRODUCT_COUNT . ',
                    (SELECT COUNT(*) FROM category AS child WHERE child.parent_id = category.id) AS child_count
               FROM category
              WHERE category.id = :id'
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();

        $row = $statement->fetch();

        return $row === false ? null : self::toAdminCategory($row) + ['childCount' => (int) $row['child_count']];
    }

    /**
     * @param string   $name      Nom à vérifier.
     * @param int|null $exceptId  Catégorie à ignorer (celle qu'on modifie), ou null.
     *
     * @return bool true si une autre catégorie porte déjà ce nom. La
     *              comparaison suit la collation : sans casse ni accents.
     */
    public function nameExists(string $name, ?int $exceptId): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT 1 FROM category WHERE name = :name AND id <> :except LIMIT 1'
        );
        $statement->bindValue(':name', $name);
        $statement->bindValue(':except', $exceptId ?? 0, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchColumn() !== false;
    }

    /**
     * @param string $slug
     *
     * @return bool true si une catégorie porte déjà ce slug.
     */
    public function slugExists(string $slug): bool
    {
        $statement = $this->pdo->prepare('SELECT 1 FROM category WHERE slug = :slug LIMIT 1');
        $statement->bindValue(':slug', $slug);
        $statement->execute();

        return $statement->fetchColumn() !== false;
    }

    /**
     * Crée une catégorie, placée après ses sœurs (même parente).
     *
     * @param array{parentId:?int, name:string, description:?string, isVisible:bool} $category
     *        Saisie déjà validée.
     * @param string $slug Slug libre, calculé par le contrôleur.
     *
     * @return int|null Identifiant de la catégorie créée, ou null si le nom ou
     *                  le slug a été pris entre-temps (clé unique).
     */
    public function create(array $category, string $slug): ?int
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO category (parent_id, name, slug, description, position, is_visible)
             VALUES (:parent, :name, :slug, :description, :position, :visible)'
        );
        self::bindValues($statement, $category);
        $statement->bindValue(':slug', $slug);
        $statement->bindValue(':position', $this->nextPosition($category['parentId']), PDO::PARAM_INT);

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
     * Modifie une catégorie. Le slug ne change pas : les adresses déjà
     * partagées (/categories/…) restent valables. Une catégorie qui change de
     * parente passe après ses nouvelles sœurs.
     *
     * @param int                                                                     $id
     * @param array{parentId:?int, name:string, description:?string, isVisible:bool} $category
     *        Saisie déjà validée.
     * @param bool $parentChanged true si la parente n'est plus la même.
     *
     * @return bool false si le nom a été pris entre-temps (clé unique).
     */
    public function update(int $id, array $category, bool $parentChanged): bool
    {
        $statement = $this->pdo->prepare(
            'UPDATE category
                SET parent_id = :parent, name = :name, description = :description,
                    is_visible = :visible' . ($parentChanged ? ', position = :position' : '') . '
              WHERE id = :id'
        );
        self::bindValues($statement, $category);
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        if ($parentChanged) {
            $statement->bindValue(':position', $this->nextPosition($category['parentId']), PDO::PARAM_INT);
        }

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
     * Supprime une catégorie. Les clés étrangères (produits, sous-catégories)
     * l'interdisent tant qu'elle n'est pas vide : le contrôleur le vérifie
     * avant, et MySQL le revérifie si un produit a été ajouté entre-temps.
     *
     * @param int $id
     *
     * @return bool false si la catégorie n'est plus vide.
     */
    public function delete(int $id): bool
    {
        $statement = $this->pdo->prepare('DELETE FROM category WHERE id = :id');
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
     * @param int|null $parentId Parente, ou null pour le premier niveau.
     *
     * @return int Position qui place une catégorie après ses sœurs.
     */
    private function nextPosition(?int $parentId): int
    {
        $statement = $this->pdo->prepare(
            'SELECT COALESCE(MAX(position), 0) + 1 FROM category WHERE parent_id <=> :parent'
        );
        $statement->bindValue(':parent', $parentId, $parentId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    /**
     * Lie les marqueurs :parent, :name, :description et :visible.
     *
     * @param PDOStatement                                                             $statement
     * @param array{parentId:?int, name:string, description:?string, isVisible:bool} $category
     */
    private static function bindValues(PDOStatement $statement, array $category): void
    {
        $statement->bindValue(':parent', $category['parentId'], $category['parentId'] === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $statement->bindValue(':name', $category['name']);
        $statement->bindValue(
            ':description',
            $category['description'],
            $category['description'] === null ? PDO::PARAM_NULL : PDO::PARAM_STR,
        );
        $statement->bindValue(':visible', $category['isVisible'] ? 1 : 0, PDO::PARAM_INT);
    }

    /**
     * Range des catégories en arbre : premier niveau, chacune avec ses
     * sous-catégories (children), dans l'ordre reçu.
     *
     * @param array<int, array{id:int, parentId:?int}> $categories
     *
     * @return array<int, array<string, mixed>>
     */
    private static function toTree(array $categories): array
    {
        $topLevel = array_values(array_filter(
            $categories,
            static fn (array $category): bool => $category['parentId'] === null,
        ));

        return array_map(
            static fn (array $parent): array => $parent + [
                'children' => array_values(array_filter(
                    $categories,
                    static fn (array $category): bool => $category['parentId'] === $parent['id'],
                )),
            ],
            $topLevel,
        );
    }

    /**
     * Convertit une ligne SQL en catégorie typée (MySQL renvoie les entiers
     * sous forme de chaînes).
     *
     * @param array{id:string, parent_id:?string, name:string, slug:string,
     *              description:?string, product_count:string} $row
     *
     * @return array{id:int, parentId:?int, name:string, slug:string,
     *               description:?string, productCount:int}
     */
    private static function toCategory(array $row): array
    {
        return [
            'id'           => (int) $row['id'],
            'parentId'     => $row['parent_id'] === null ? null : (int) $row['parent_id'],
            'name'         => $row['name'],
            'slug'         => $row['slug'],
            'description'  => $row['description'],
            'productCount' => (int) $row['product_count'],
        ];
    }

    /**
     * Comme toCategory, avec la visibilité (back-office, US GOF-c).
     *
     * @param array{id:string, parent_id:?string, name:string, slug:string,
     *              description:?string, is_visible:string, product_count:string} $row
     *
     * @return array{id:int, parentId:?int, name:string, slug:string,
     *               description:?string, isVisible:bool, productCount:int}
     */
    private static function toAdminCategory(array $row): array
    {
        return self::toCategory($row) + ['isVisible' => (int) $row['is_visible'] === 1];
    }
}
