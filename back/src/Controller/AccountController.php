<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\CustomerModel;
use App\Model\DealershipModel;
use App\Model\OrderModel;
use PDOException;

/**
 * Espace personnel (US SUI-b) : informations du compte connecté, dernière
 * commande, modification des informations et du mot de passe.
 *
 * Le compte modifié est toujours celui de la session : aucun identifiant de
 * compte ne vient du navigateur. Les saisies suivent les règles de la
 * création de compte (validateurs publics d'AuthController), et leurs erreurs
 * sont renvoyées champ par champ (clé « champs »).
 */
final class AccountController
{
    /** Accès aux comptes. */
    private CustomerModel $customers;

    /** Accès aux concessions. */
    private DealershipModel $dealerships;

    /** Accès aux commandes. */
    private OrderModel $orders;

    /**
     * @param CustomerModel   $customers   Accès aux comptes.
     * @param DealershipModel $dealerships Accès aux concessions.
     * @param OrderModel      $orders      Accès aux commandes.
     */
    public function __construct(CustomerModel $customers, DealershipModel $dealerships, OrderModel $orders)
    {
        $this->customers   = $customers;
        $this->dealerships = $dealerships;
        $this->orders      = $orders;
    }

    /**
     * GET /api/account
     *
     * Répond { customer, dealerships, lastOrder } :
     * - customer : prénom, nom, e-mail, téléphone et concession préférée
     *   (preferredDealershipId, ou null) du compte connecté ;
     * - dealerships : les concessions, pour le choix de la concession préférée ;
     * - lastOrder : sa commande la plus récente, avec dayOffset (jour du
     *   créneau par rapport à aujourd'hui, comme l'historique), ou null.
     *
     * 401 si personne n'est connecté.
     */
    public function show(): void
    {
        $customer  = $this->requireCustomer();
        $lastOrder = $this->orders->findLastByCustomer($customer['id']);

        Response::json([
            'customer'    => self::toPublicCustomer($customer),
            'dealerships' => $this->dealerships->findAll(),
            'lastOrder'   => $lastOrder === null
                ? null
                : $lastOrder + ['dayOffset' => OrderController::pickupDayOffset($lastOrder['pickupStart'])],
        ]);
    }

    /**
     * POST /api/account, corps JSON
     * { firstName, lastName, email, phone, preferredDealershipId }.
     *
     * Enregistre les informations du compte connecté : répond { customer }.
     * preferredDealershipId vaut null (aucune préférence) ou l'identifiant
     * d'une concession. 401 si personne n'est connecté, 422 si une saisie est
     * invalide, 409 si l'adresse e-mail est celle d'un autre compte.
     *
     * @param Request $request Requête entrante.
     */
    public function update(Request $request): void
    {
        $customer = $this->requireCustomer();
        $body     = $request->corps();

        $profile = [
            'firstName'             => trim(AuthController::text($body, 'firstName')),
            'lastName'              => trim(AuthController::text($body, 'lastName')),
            'email'                 => AuthController::normalizeEmail(AuthController::text($body, 'email')),
            'phone'                 => AuthController::normalizePhone(AuthController::text($body, 'phone')),
            'preferredDealershipId' => null,
        ];

        $dealershipErrors = [];
        $dealershipId     = $body['preferredDealershipId'] ?? null;

        // null ou "" : aucune préférence. Sinon, une concession existante.
        if ($dealershipId !== null && $dealershipId !== '') {
            $dealershipId = filter_var($dealershipId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

            if ($dealershipId === false || $this->dealerships->findById($dealershipId) === null) {
                $dealershipErrors = ['preferredDealershipId' => 'Choisissez une concession de la liste.'];
            } else {
                $profile['preferredDealershipId'] = $dealershipId;
            }
        }

        $errors = array_merge(
            AuthController::validateName($profile['firstName'], 'firstName', 'votre prénom'),
            AuthController::validateName($profile['lastName'], 'lastName', 'votre nom'),
            AuthController::validateEmail($profile['email']),
            AuthController::validatePhone($profile['phone']),
            $dealershipErrors,
        );

        if ($errors !== []) {
            AuthController::fieldErrors($errors, 422);
        }

        try {
            $this->customers->updateProfile($customer['id'], $profile);
        } catch (PDOException $e) {
            if ($e->getCode() !== CustomerModel::DUPLICATE) {
                throw $e;
            }
            AuthController::fieldErrors(['email' => 'Un autre compte utilise déjà cette adresse e-mail.'], 409);
        }

        Response::json(['customer' => self::toPublicCustomer($this->customers->findById($customer['id']))]);
    }

    /**
     * POST /api/account/password, corps JSON
     * { currentPassword, password, passwordConfirm }.
     *
     * Remplace le mot de passe du compte connecté, après vérification du mot
     * de passe actuel : répond { modifie: true }. La session reçoit un nouvel
     * identifiant, comme après une connexion. 401 si personne n'est connecté,
     * 422 si le mot de passe actuel est faux ou le nouveau invalide.
     *
     * @param Request $request Requête entrante.
     */
    public function changePassword(Request $request): void
    {
        $customer = $this->requireCustomer();
        $body     = $request->corps();
        $password = AuthController::text($body, 'password');
        $hash     = $this->customers->findPasswordHash($customer['id']);

        $errors = AuthController::validatePassword($password, AuthController::text($body, 'passwordConfirm'));

        if ($hash === null || !password_verify(AuthController::text($body, 'currentPassword'), $hash)) {
            $errors['currentPassword'] = 'Mot de passe actuel incorrect.';
        }

        if ($errors !== []) {
            AuthController::fieldErrors($errors, 422);
        }

        $this->customers->updatePassword($customer['id'], password_hash($password, PASSWORD_DEFAULT));
        session_regenerate_id(true);

        Response::json(['modifie' => true]);
    }

    /**
     * Compte connecté, relu en base. Répond 401 (et s'arrête) s'il n'y en a pas.
     *
     * @return array{id:int, firstName:string, lastName:string, email:string, phone:string, role:string,
     *               preferredDealershipId:?int}
     */
    private function requireCustomer(): array
    {
        $id       = $_SESSION['customerId'] ?? null;
        $customer = is_int($id) ? $this->customers->findById($id) : null;

        if ($customer === null) {
            Response::erreur('Connectez-vous pour accéder à votre espace personnel.', 401);
        }

        return $customer;
    }

    /**
     * Informations du compte envoyées au navigateur : ni identifiant ni rôle.
     *
     * @param array{id:int, firstName:string, lastName:string, email:string, phone:string, role:string,
     *              preferredDealershipId:?int} $customer
     *
     * @return array{firstName:string, lastName:string, email:string, phone:string, preferredDealershipId:?int}
     */
    private static function toPublicCustomer(array $customer): array
    {
        return [
            'firstName'             => $customer['firstName'],
            'lastName'              => $customer['lastName'],
            'email'                 => $customer['email'],
            'phone'                 => $customer['phone'],
            'preferredDealershipId' => $customer['preferredDealershipId'],
        ];
    }
}
