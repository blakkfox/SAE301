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
     * aux coordonnées de la validation de commande (CMD-a), la concession
     * préférée à son choix par défaut (SUI-b).
     *
     * @param int $id Identifiant du compte.
     *
     * @return array{id:int, firstName:string, lastName:string, email:string, phone:string, role:string,
     *               preferredDealershipId:?int}|null
     *         null si le compte n'existe plus.
     */
    public function findById(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT id, first_name, last_name, email, phone, role, preferred_dealership_id
               FROM customer WHERE id = :id'
        );
        $statement->execute(['id' => $id]);
        $row = $statement->fetch();

        if ($row === false) {
            return null;
        }

        return [
            'id'                    => (int) $row['id'],
            'firstName'             => $row['first_name'],
            'lastName'              => $row['last_name'],
            'email'                 => $row['email'],
            'phone'                 => $row['phone'],
            'role'                  => $row['role'],
            'preferredDealershipId' => $row['preferred_dealership_id'] === null
                ? null
                : (int) $row['preferred_dealership_id'],
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
     * Modifie les informations d'un compte (US SUI-b).
     *
     * Comme pour create(), une adresse déjà prise par un autre compte lève une
     * PDOException de code DUPLICATE.
     *
     * @param int $id Identifiant du compte.
     * @param array{firstName:string, lastName:string, email:string, phone:string,
     *              preferredDealershipId:?int} $profile Saisies déjà validées.
     */
    public function updateProfile(int $id, array $profile): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE customer
                SET first_name = :firstName, last_name = :lastName, email = :email, phone = :phone,
                    preferred_dealership_id = :dealershipId
              WHERE id = :id'
        );
        $statement->bindValue(':firstName', $profile['firstName']);
        $statement->bindValue(':lastName', $profile['lastName']);
        $statement->bindValue(':email', $profile['email']);
        $statement->bindValue(':phone', $profile['phone']);
        $statement->bindValue(
            ':dealershipId',
            $profile['preferredDealershipId'],
            $profile['preferredDealershipId'] === null ? PDO::PARAM_NULL : PDO::PARAM_INT,
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
    }

    /**
     * Empreinte du mot de passe d'un compte, pour vérifier le mot de passe
     * actuel avant d'en changer (US SUI-b).
     *
     * @param int $id Identifiant du compte.
     *
     * @return string|null null si le compte n'existe plus.
     */
    public function findPasswordHash(int $id): ?string
    {
        $statement = $this->pdo->prepare('SELECT password_hash FROM customer WHERE id = :id');
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
        $hash = $statement->fetchColumn();

        return $hash === false ? null : $hash;
    }

    /**
     * Remplace le mot de passe d'un compte identifié par la session (US SUI-b).
     *
     * @param int    $id           Identifiant du compte.
     * @param string $passwordHash Nouvelle empreinte, produite par password_hash().
     */
    public function updatePassword(int $id, string $passwordHash): void
    {
        $statement = $this->pdo->prepare('UPDATE customer SET password_hash = :passwordHash WHERE id = :id');
        $statement->bindValue(':passwordHash', $passwordHash);
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();
    }

    /**
     * Remplace le mot de passe d'un compte CLIENT dont l'adresse e-mail et le
     * numéro de téléphone correspondent (mot de passe oublié). Les comptes
     * d'administration sont exclus.
     *
     * @param string             $email        Adresse e-mail, en minuscules.
     * @param array<int, string> $phones       Écritures acceptées du numéro (« 06… », « +336… »).
     * @param string             $passwordHash Nouvelle empreinte, produite par password_hash().
     *
     * @return bool false si aucun compte client n'a cette adresse et ce numéro.
     */
    public function updateCustomerPassword(string $email, array $phones, string $passwordHash): bool
    {
        $statement = $this->pdo->prepare(
            'UPDATE customer SET password_hash = :passwordHash
             WHERE email = :email AND phone IN (:phone0, :phone1) AND role = \'customer\''
        );
        $statement->execute([
            'passwordHash' => $passwordHash,
            'email'        => $email,
            'phone0'       => $phones[0],
            'phone1'       => $phones[1],
        ]);

        return $statement->rowCount() > 0;
    }
}
