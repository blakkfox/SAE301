<?php

declare(strict_types=1);

namespace App\Model;

use PDO;

/**
 * Accès aux catégories du catalogue (US DEC-a).
 *
 * Comme ProductModel, cette couche exécute les requêtes et renvoie des
 * tableaux typés, sans rien décider.
 */
final class CategoryModel
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
     * Identifiant d'une catégorie à partir de son slug (« collection-honda »).
     *
     * @param string $slug Slug lu dans l'adresse.
     *
     * @return int|null L'identifiant, ou null si aucune catégorie n'a ce slug.
     */
    public function findIdBySlug(string $slug): ?int
    {
        $statement = $this->pdo->prepare('SELECT id FROM category WHERE slug = :slug');
        $statement->bindValue(':slug', $slug);
        $statement->execute();

        $id = $statement->fetchColumn();

        return $id === false ? null : (int) $id;
    }

    /**
     * Toutes les catégories, en arbre : les catégories de premier niveau, chacune
     * avec ses sous-catégories (children), dans l'ordre d'affichage.
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
              ORDER BY category.position, category.id';

        $categories = array_map([self::class, 'toCategory'], $this->pdo->query($sql)->fetchAll());

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
}
