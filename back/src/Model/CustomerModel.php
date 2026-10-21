<?php

declare(strict_types=1);

namespace App\Model;

use PDO;

/**
 * Accès aux comptes (US CMD-c) : clients et administrateurs.
 *
 * Cette couche ne contient aucune règle métier : la validation des saisies
 * et la vérification des mots de passe sont faites par AuthController. Elle
 * ne reçoit et ne renvoie jamais un mot de passe en clair, seulement son
 * empreinte (password_hash).
 */
final class CustomerModel
{
    /** Code SQLSTATE d'une violation de contrainte (ici : e-mail déjà pris). */
    public const DUPLICATE = '23000';

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
     * Compte d'une adresse e-mail, avec l'empreinte de son mot de passe et
     * son rôle : de quoi vérifier une connexion, client ou administrateur
     * (GOF-b).
     *
     * @param string $email Adresse e-mail, en minuscules.
     *
     * @return array{id:int, passwordHash:string, role:string}|null null si aucun compte.
     */
    public function findCredentials(string $email): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, password_hash, role FROM customer WHERE email = :email'
        );
        $statement->execute(['email' => $email]);
        $row = $statement->fetch();

        if ($row === false) {
            return null;
        }

        return ['id' => (int) $row['id'], 'passwordHash' => $row['password_hash'], 'role' => $row['role']];
    }

    /**
     * Compte connecté, sans son empreinte de mot de passe. Le téléphone sert
     * aux coordonnées de la validation de commande (CMD-a).
     *
     * @param int $id Identifiant du compte.
     *
     * @return array{id:int, firstName:string, lastName:string, email:string, phone:string, role:string}|null
     *         null si le compte n'existe plus.
     */
    public function findById(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, first_name, last_name, email, phone, role FROM customer WHERE id = :id'
        );
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();

        if ($row === false) {
            return null;
        }

        return [
            'id'        => (int) $row['id'],
            'firstName' => $row['first_name'],
            'lastName'  => $row['last_name'],
            'email'     => $row['email'],
            'phone'     => $row['phone'],
            'role'      => $row['role'],
        ];
    }

    /**
     * Crée un compte client.
     *
     * Une adresse déjà enregistrée lève une PDOException de code DUPLICATE
     * (index unique uq_customer_email) : c'est la base qui tranche, même si
     * deux inscriptions arrivent en même temps.
     *
     * @param array{firstName:string, lastName:string, email:string, phone:string} $customer
     *        Saisies déjà validées.
     * @param string $passwordHash Empreinte produite par password_hash().
     *
     * @return int Identifiant du compte créé.
     */
    public function create(array $customer, string $passwordHash): int
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO customer (first_name, last_name, email, phone, password_hash, role)
             VALUES (:firstName, :lastName, :email, :phone, :passwordHash, \'customer\')'
        );
        $statement->execute([
            'firstName'    => $customer['firstName'],
            'lastName'     => $customer['lastName'],
            'email'        => $customer['email'],
            'phone'        => $customer['phone'],
            'passwordHash' => $passwordHash,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    /**
     * Remplace le mot de passe d'un compte CLIENT. Les comptes
     * d'administration sont exclus : la réinitialisation ne vérifie pas
     * l'identité du demandeur.
     *
     * @param string $email        Adresse e-mail, en minuscules.
     * @param string $passwordHash Nouvelle empreinte, produite par password_hash().
     *
     * @return bool false si aucun compte client n'a cette adresse.
     */
    public function updateCustomerPassword(string $email, string $passwordHash): bool
    {
        $statement = $this->pdo->prepare(
            'UPDATE customer SET password_hash = :passwordHash
             WHERE email = :email AND role = \'customer\''
        );
        $statement->execute(['passwordHash' => $passwordHash, 'email' => $email]);

        return $statement->rowCount() > 0;
    }
}
