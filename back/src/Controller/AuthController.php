<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;

/**
 * Connexion et déconnexion.
 *
 * L'identité et le rôle de l'utilisateur connecté sont rangés en session,
 * côté serveur. Le client ne détient que l'identifiant de session, dans le
 * cookie PHPSESSID.
 */
final class AuthController
{
    // Comptes en dur : suffisant ici, à ne jamais faire en production.
    private const COMPTES = [
        'alice' => ['mdp' => 'azerty',     'role' => 'user'],
        'admin' => ['mdp' => 'motdepasse', 'role' => 'admin'],
    ];

    public function login(Request $requete): void
    {
        $corps = $requete->corps();
        $login = (string) ($corps['login'] ?? '');
        $mdp   = (string) ($corps['mdp']   ?? '');

        $compte = self::COMPTES[$login] ?? null;

        if ($compte === null || $compte['mdp'] !== $mdp) {
            Response::erreur('Identifiants invalides', 401);
        }

        // L'utilisateur devient authentifié : on lui attribue un identifiant de
        // session neuf, et on détruit l'ancien (true). Aucun identifiant connu
        // avant ce point ne donne plus accès à la session.
        session_regenerate_id(true);

        $_SESSION['utilisateur'] = $login;
        $_SESSION['role']        = $compte['role'];

        Response::json(['connecte' => true, 'role' => $compte['role']]);
    }

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

        Response::json(['connecte' => false]);
    }
}
