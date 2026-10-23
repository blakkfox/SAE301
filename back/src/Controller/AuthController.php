<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\CustomerModel;
use App\Model\LoginAttemptModel;
use PDOException;

/**
 * Authentification (US CMD-c) : connexion, création de compte, mot de passe
 * oublié, compte connecté et déconnexion ; connexion du back-office (US GOF-b).
 *
 * L'identifiant et le rôle du compte connecté sont rangés en session, côté
 * serveur. Le client ne détient que l'identifiant de session, dans le cookie
 * PHPSESSID : il ne peut ni choisir son rôle ni se faire passer pour un autre.
 *
 * Les essais à la chaîne sont freinés : après ATTEMPTS_PER_EMAIL échecs en
 * ATTEMPT_WINDOW minutes pour une même adresse depuis une même IP, ou
 * ATTEMPTS_PER_IP échecs depuis une même IP, connexion et mot de passe
 * oublié répondent 429 jusqu'à la fin de la fenêtre.
 *
 * Les erreurs de saisie sont renvoyées champ par champ (422, clé « champs »),
 * pour que le front les affiche sous le bon champ, comme sur la maquette.
 * Les fonctions de validation sont publiques : l'espace personnel
 * (AccountController, US SUI-b) applique les mêmes règles.
 */
final class AuthController
{
    /** Longueur minimale d'un mot de passe (maquette : « 8 caractères minimum »). */
    private const PASSWORD_MIN = 8;

    /** password_hash (bcrypt) ignore tout ce qui dépasse 72 octets. */
    private const PASSWORD_MAX_BYTES = 72;

    /** Longueur maximale d'un prénom ou d'un nom (colonnes VARCHAR(60)). */
    private const NAME_MAX = 60;

    /** Longueur maximale d'une adresse e-mail (colonne VARCHAR(190)). */
    private const EMAIL_MAX = 190;

    /** Échecs permis pour une même adresse e-mail depuis une même IP, sur la fenêtre. */
    private const ATTEMPTS_PER_EMAIL = 5;

    /** Échecs permis depuis une même IP, toutes adresses confondues, sur la fenêtre. */
    private const ATTEMPTS_PER_IP = 20;

    /** Fenêtre de comptage des échecs, en minutes. */
    private const ATTEMPT_WINDOW = 15;

    /** Réponse au-delà des essais permis. */
    private const TOO_MANY_ATTEMPTS = 'Trop de tentatives : réessayez dans ' . self::ATTEMPT_WINDOW . ' minutes.';

    /** Prénom ou nom : une lettre, puis lettres, espaces, apostrophes, points et tirets. */
    private const NAME_PATTERN = "/^\\p{L}[\\p{L}\\p{M}' .’-]*$/u";

    /** Message unique, que l'e-mail existe ou non : on ne révèle pas quels comptes existent. */
    private const LOGIN_FAILED = 'Adresse e-mail ou mot de passe incorrect.';

    /** Refus de la connexion du back-office : mêmes raisons, même discrétion. */
    private const ADMIN_LOGIN_FAILED = 'Identifiant ou mot de passe incorrect.';

    /**
     * Empreinte d'un mot de passe aléatoire, vérifiée quand l'e-mail est
     * inconnu : la réponse prend alors autant de temps que pour un compte
     * existant, et sa durée ne trahit pas les adresses enregistrées.
     */
    private const DUMMY_HASH = '$2y$12$wzr/OEypcM59Mzsrh3Nkm.IrO8ckxvSZogKjY3ruQXDvfytxzk.tK';

    /** Le modèle qui interroge la table customer, fourni à la construction. */
    private CustomerModel $customers;

    /** Le journal des tentatives refusées, fourni à la construction. */
    private LoginAttemptModel $attempts;

    /**
     * @param CustomerModel     $customers Accès aux comptes.
     * @param LoginAttemptModel $attempts  Journal des tentatives refusées.
     */
    public function __construct(CustomerModel $customers, LoginAttemptModel $attempts)
    {
        $this->customers = $customers;
        $this->attempts  = $attempts;
    }

    /**
     * POST /api/login, corps JSON { email, password }.
     *
     * Répond { customer } et ouvre la session. 401 si les identifiants ne
     * correspondent à aucun compte, 429 après trop d'échecs.
     *
     * @param Request $request Requête entrante.
     */
    public function login(Request $request): void
    {
        $body     = $request->corps();
        $email    = self::normalizeEmail(self::text($body, 'email'));
        $password = self::text($body, 'password');

        $this->checkAttempts($request->ip(), $email);

        $credentials = $this->customers->findCredentials($email);

        // password_verify est appelé dans tous les cas, voir DUMMY_HASH.
        $isValid = password_verify($password, $credentials['passwordHash'] ?? self::DUMMY_HASH);

        if ($credentials === null || !$isValid) {
            $this->attempts->record($request->ip(), $email, self::ATTEMPT_WINDOW);
            Response::erreur(self::LOGIN_FAILED, 401);
        }

        $this->attempts->clear($request->ip(), $email, self::ATTEMPT_WINDOW);
        $this->openSession($credentials['id']);
    }

    /**
     * POST /api/admin/login, corps JSON { email, password } (US GOF-b).
     *
     * Connexion du back-office, séparée de celle des clients : un compte
     * client y est refusé avec le même message qu'un mauvais mot de passe,
     * pour ne pas révéler quelles adresses sont des comptes d'administration.
     * Répond { customer } et ouvre la session. 401 sinon, 429 après trop d'échecs.
     *
     * @param Request $request Requête entrante.
     */
    public function adminLogin(Request $request): void
    {
        $body     = $request->corps();
        $email    = self::normalizeEmail(self::text($body, 'email'));
        $password = self::text($body, 'password');

        $this->checkAttempts($request->ip(), $email);

        $credentials = $this->customers->findCredentials($email);

        // password_verify est appelé dans tous les cas, voir DUMMY_HASH.
        $isValid = password_verify($password, $credentials['passwordHash'] ?? self::DUMMY_HASH);

        if ($credentials === null || !$isValid || $credentials['role'] !== 'admin') {
            $this->attempts->record($request->ip(), $email, self::ATTEMPT_WINDOW);
            Response::erreur(self::ADMIN_LOGIN_FAILED, 401);
        }

        $this->attempts->clear($request->ip(), $email, self::ATTEMPT_WINDOW);
        $this->openSession($credentials['id']);
    }

    /**
     * POST /api/register, corps JSON
     * { firstName, lastName, email, phone, password, passwordConfirm }.
     *
     * Crée un compte client et le connecte aussitôt : répond { customer }, en
     * 201. 422 si une saisie est invalide, 409 si l'adresse est déjà prise.
     *
     * @param Request $request Requête entrante.
     */
    public function register(Request $request): void
    {
        $body = $request->corps();

        $customer = [
            'firstName' => trim(self::text($body, 'firstName')),
            'lastName'  => trim(self::text($body, 'lastName')),
            'email'     => self::normalizeEmail(self::text($body, 'email')),
            'phone'     => self::normalizePhone(self::text($body, 'phone')),
        ];
        $password = self::text($body, 'password');

        $errors = array_merge(
            self::validateName($customer['firstName'], 'firstName', 'votre prénom'),
            self::validateName($customer['lastName'], 'lastName', 'votre nom'),
            self::validateEmail($customer['email']),
            self::validatePhone($customer['phone']),
            self::validatePassword($password, self::text($body, 'passwordConfirm')),
        );

        if ($errors !== []) {
            self::fieldErrors($errors, 422);
        }

        try {
            $id = $this->customers->create($customer, password_hash($password, PASSWORD_DEFAULT));
        } catch (PDOException $e) {
            if ($e->getCode() !== CustomerModel::DUPLICATE) {
                throw $e;
            }
            self::fieldErrors(['email' => 'Un compte existe déjà avec cette adresse e-mail.'], 409);
        }

        $this->openSession($id, 201);
    }

    /**
     * POST /api/password-reset, corps JSON
     * { email, phone, password, passwordConfirm }.
     *
     * Mot de passe oublié, version simplifiée du projet (pas d'e-mail de
     * confirmation) : l'identité est vérifiée par le numéro de téléphone du
     * compte, qui doit correspondre à l'adresse. Seuls les comptes clients
     * sont concernés, et l'utilisateur n'est pas connecté : il doit ensuite
     * se connecter avec son nouveau mot de passe. Les échecs comptent comme
     * ceux de la connexion.
     *
     * Répond { modifie: true }. 422 si une saisie est invalide, 404 si aucun
     * compte client n'a cette adresse et ce numéro (même message dans les
     * deux cas : on ne révèle pas quels comptes existent), 429 après trop
     * d'échecs.
     *
     * @param Request $request Requête entrante.
     */
    public function resetPassword(Request $request): void
    {
        $body     = $request->corps();
        $email    = self::normalizeEmail(self::text($body, 'email'));
        $phone    = self::normalizePhone(self::text($body, 'phone'));
        $password = self::text($body, 'password');

        $errors = array_merge(
            self::validateEmail($email),
            self::validatePhone($phone),
            self::validatePassword($password, self::text($body, 'passwordConfirm')),
        );

        if ($errors !== []) {
            self::fieldErrors($errors, 422);
        }

        $this->checkAttempts($request->ip(), $email);

        $isUpdated = $this->customers->updateCustomerPassword(
            $email,
            self::phoneForms($phone),
            password_hash($password, PASSWORD_DEFAULT),
        );

        if (!$isUpdated) {
            $this->attempts->record($request->ip(), $email, self::ATTEMPT_WINDOW);
            self::fieldErrors(['phone' => 'Cette adresse e-mail et ce numéro ne correspondent à aucun compte client.'], 404);
        }

        $this->attempts->clear($request->ip(), $email, self::ATTEMPT_WINDOW);
        Response::json(['modifie' => true]);
    }

    /**
     * GET /api/me
     *
     * Répond { customer } : le compte connecté, ou null. Le compte est relu en
     * base : un compte supprimé depuis la connexion n'est plus reconnu.
     */
    public function me(): void
    {
        $id = $_SESSION['customerId'] ?? null;

        Response::json(['customer' => is_int($id) ? $this->customers->findById($id) : null]);
    }

    /**
     * POST /api/logout
     *
     * Ferme la session et supprime son cookie. Répond { customer: null }.
     */
    public function logout(): void
    {
        $_SESSION = [];                               // vide la copie en mémoire

        // Supprime le cookie, avec le chemin sous lequel il a été posé : celui
        // que index.php a réglé avant session_start().
        setcookie(session_name(), '', [
            'expires' => time() - 3600,
            'path'    => session_get_cookie_params()['path'],
        ]);

        session_destroy();                            // efface le fichier serveur

        Response::json(['customer' => null]);
    }

    /**
     * Répond 429 et s'arrête si les échecs récents depuis cette IP dépassent
     * le nombre permis, pour cette adresse e-mail ou toutes confondues.
     *
     * @param string $ip    Adresse IP du client.
     * @param string $email Adresse e-mail saisie, normalisée.
     */
    private function checkAttempts(string $ip, string $email): void
    {
        if (
            $this->attempts->countRecent($ip, $email, self::ATTEMPT_WINDOW) >= self::ATTEMPTS_PER_EMAIL
            || $this->attempts->countRecent($ip, null, self::ATTEMPT_WINDOW) >= self::ATTEMPTS_PER_IP
        ) {
            Response::erreur(self::TOO_MANY_ATTEMPTS, 429);
        }
    }

    /**
     * Les deux écritures d'un même numéro français, telles qu'un compte peut
     * les avoir enregistrées : « 0601020304 » et « +33601020304 ».
     *
     * @param string $phone Numéro normalisé et valide.
     *
     * @return array<int, string>
     */
    private static function phoneForms(string $phone): array
    {
        $national = str_starts_with($phone, '+33') ? '0' . substr($phone, 3) : $phone;

        return [$national, '+33' . substr($national, 1)];
    }

    /**
     * Connecte un compte et répond { customer }.
     *
     * @param int $id     Compte à connecter.
     * @param int $status Code HTTP de la réponse.
     */
    private function openSession(int $id, int $status = 200): void
    {
        // L'utilisateur devient authentifié : on lui attribue un identifiant de
        // session neuf, et on détruit l'ancien (true). Aucun identifiant connu
        // avant ce point ne donne plus accès à la session.
        session_regenerate_id(true);

        $customer = $this->customers->findById($id);

        $_SESSION['customerId'] = $id;
        $_SESSION['role']       = $customer['role'];

        Response::json(['customer' => $customer], $status);
    }

    /**
     * Répond par des erreurs de saisie, une par champ.
     *
     * @param array<string, string> $errors Message de chaque champ en erreur.
     * @param int                   $status Code HTTP de la réponse.
     */
    public static function fieldErrors(array $errors, int $status): void
    {
        Response::json(['erreur' => 'Certains champs sont à corriger.', 'champs' => $errors], $status);
    }

    /**
     * Valeur texte d'un champ du corps JSON. Un champ absent ou d'un autre
     * type (tableau, nombre…) vaut une chaîne vide, et sera refusé par la
     * validation.
     *
     * @param array<string, mixed> $body Corps de la requête.
     * @param string               $key  Nom du champ.
     *
     * @return string
     */
    public static function text(array $body, string $key): string
    {
        $value = $body[$key] ?? '';

        return is_string($value) ? $value : '';
    }

    /**
     * @param string $email Adresse saisie.
     *
     * @return string L'adresse sans espaces autour, en minuscules : « Alice@… »
     *                et « alice@… » désignent le même compte.
     */
    public static function normalizeEmail(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    /**
     * @param string $phone Numéro saisi, par exemple « 06 01 02 03 04 ».
     *
     * @return string Le numéro sans espaces, points ni tirets.
     */
    public static function normalizePhone(string $phone): string
    {
        return preg_replace('/[\s.\-]/', '', $phone) ?? '';
    }

    /**
     * @param string $value Prénom ou nom, sans espaces autour.
     * @param string $field Nom du champ.
     * @param string $label Libellé utilisé dans le message.
     *
     * @return array<string, string> L'erreur du champ, ou un tableau vide.
     */
    public static function validateName(string $value, string $field, string $label): array
    {
        if ($value === '') {
            return [$field => "Indiquez {$label}."];
        }
        if (mb_strlen($value) > self::NAME_MAX) {
            return [$field => self::NAME_MAX . ' caractères maximum.'];
        }
        if (preg_match(self::NAME_PATTERN, $value) !== 1) {
            return [$field => 'Lettres, espaces, apostrophes et tirets seulement.'];
        }

        return [];
    }

    /**
     * @param string $email Adresse normalisée.
     *
     * @return array<string, string> L'erreur du champ, ou un tableau vide.
     */
    public static function validateEmail(string $email): array
    {
        if ($email === '') {
            return ['email' => 'Indiquez votre adresse e-mail.'];
        }
        if (mb_strlen($email) > self::EMAIL_MAX || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return ['email' => 'Adresse e-mail invalide (exemple : nom@exemple.fr).'];
        }

        return [];
    }

    /**
     * @param string $phone Numéro normalisé.
     *
     * @return array<string, string> L'erreur du champ, ou un tableau vide.
     */
    public static function validatePhone(string $phone): array
    {
        if ($phone === '') {
            return ['phone' => 'Indiquez votre numéro de téléphone.'];
        }
        // Numéro français : 0 ou +33, puis 9 chiffres dont le premier n'est pas 0.
        if (preg_match('/^(?:0|\+33)[1-9]\d{8}$/', $phone) !== 1) {
            return ['phone' => 'Numéro invalide (exemple : 06 00 00 00 00).'];
        }

        return [];
    }

    /**
     * @param string $password Mot de passe saisi.
     * @param string $confirm  Confirmation saisie.
     *
     * @return array<string, string> Les erreurs des champs password et
     *                               passwordConfirm, ou un tableau vide.
     */
    public static function validatePassword(string $password, string $confirm): array
    {
        if (mb_strlen($password) < self::PASSWORD_MIN) {
            return ['password' => self::PASSWORD_MIN . ' caractères minimum.'];
        }
        if (strlen($password) > self::PASSWORD_MAX_BYTES) {
            return ['password' => 'Mot de passe trop long (' . self::PASSWORD_MAX_BYTES . ' caractères maximum).'];
        }
        if ($password !== $confirm) {
            return ['passwordConfirm' => 'Les deux mots de passe ne correspondent pas.'];
        }

        return [];
    }
}
