<?php

declare(strict_types=1);

namespace App\Core;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Point d'accès unique à la base de données.
 *
 * La connexion est créée une seule fois puis réutilisée pendant toute la durée
 * de la requête.
 */
final class Database
{
    private static ?PDO $pdo = null;

    /**
     * @param array{hote:string,port:int,base:string,utilisateur:string,motdepasse:string} $config
     */
    public static function connexion(array $config): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $config['hote'],
            $config['port'],
            $config['base'],
        );

        try {
            self::$pdo = new PDO($dsn, $config['utilisateur'], $config['motdepasse'], [
                // Toute erreur SQL lève une exception au lieu de passer inaperçue.
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                // fetchAll() renvoie des tableaux associatifs, pas des doublons indexés.
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Les requêtes préparées sont réellement préparées par MySQL,
                // et non simulées par PDO : les types sont ainsi respectés.
                PDO::ATTR_EMULATE_PREPARES   => false,
            ]);
        } catch (PDOException $e) {
            throw new RuntimeException(
                'Connexion à la base impossible. Vérifiez back/config/config.php '
                . 'et que la base « ' . $config['base'] . ' » a bien été importée. '
                . '(' . $e->getMessage() . ')',
                // « previous: » désigne le paramètre par son nom plutôt que par
                // sa position. On saute ainsi le deuxième paramètre du
                // constructeur (un code d'erreur dont nous n'avons pas l'usage)
                // sans avoir à lui inventer une valeur.
                previous: $e,
            );
        }

        return self::$pdo;
    }
}
