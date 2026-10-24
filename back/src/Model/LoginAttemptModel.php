<?php

declare(strict_types=1);

namespace App\Model;

use PDO;

/**
 * Journal des tentatives d'identification refusées (connexion client ou
 * administrateur, mot de passe oublié), pour limiter les essais de mots de
 * passe à la chaîne.
 *
 * Cette couche ne décide de rien : AuthController fixe les seuils et la
 * durée, elle ne fait que compter, inscrire et effacer.
 */
final class LoginAttemptModel
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
     * Nombre d'échecs récents depuis une adresse IP, pour une adresse e-mail
     * ou pour toutes.
     *
     * @param string      $ip      Adresse IP du client.
     * @param string|null $email   Adresse e-mail visée, ou null pour toutes.
     * @param int         $minutes Fenêtre de temps, en minutes.
     *
     * @return int
     */
    public function countRecent(string $ip, ?string $email, int $minutes): int
    {
        $statement = $this->pdo->prepare(
            'SELECT COUNT(*) FROM login_attempt
              WHERE ip = :ip
                AND created_at >= NOW() - INTERVAL :minutes MINUTE'
            . ($email === null ? '' : ' AND email = :email')
        );
        $statement->bindValue(':ip', $ip);
        $statement->bindValue(':minutes', $minutes, PDO::PARAM_INT);
        if ($email !== null) {
            $statement->bindValue(':email', $email);
        }
        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    /**
     * Inscrit un échec, et efface ceux devenus trop anciens pour compter :
     * sans connexion réussie, la table ne grossit pas indéfiniment.
     *
     * @param string $ip      Adresse IP du client.
     * @param string $email   Adresse e-mail saisie (tronquée à la taille de la colonne).
     * @param int    $minutes Fenêtre de temps des comptages, en minutes.
     */
    public function record(string $ip, string $email, int $minutes): void
    {
        $purge = $this->pdo->prepare('DELETE FROM login_attempt WHERE created_at < NOW() - INTERVAL :minutes MINUTE');
        $purge->bindValue(':minutes', $minutes, PDO::PARAM_INT);
        $purge->execute();

        $statement = $this->pdo->prepare('INSERT INTO login_attempt (ip, email) VALUES (:ip, :email)');
        $statement->bindValue(':ip', $ip);
        $statement->bindValue(':email', mb_substr($email, 0, 190));
        $statement->execute();
    }

    /**
     * Efface les échecs d'une adresse e-mail depuis une adresse IP, après une
     * identification réussie, et ceux devenus trop anciens pour compter.
     *
     * @param string $ip      Adresse IP du client.
     * @param string $email   Adresse e-mail identifiée.
     * @param int    $minutes Fenêtre de temps des comptages, en minutes.
     */
    public function clear(string $ip, string $email, int $minutes): void
    {
        $statement = $this->pdo->prepare(
            'DELETE FROM login_attempt
              WHERE (ip = :ip AND email = :email)
                 OR created_at < NOW() - INTERVAL :minutes MINUTE'
        );
        $statement->bindValue(':ip', $ip);
        $statement->bindValue(':email', $email);
        $statement->bindValue(':minutes', $minutes, PDO::PARAM_INT);
        $statement->execute();
    }
}
