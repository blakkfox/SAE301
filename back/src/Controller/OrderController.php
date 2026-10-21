<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\CustomerModel;
use App\Model\DealershipModel;
use App\Model\OrderModel;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Validation de la commande (US CMD-a) : concession, créneau de retrait et
 * paiement sur place.
 *
 * Les deux routes exigent un compte connecté (identifiant rangé en session
 * par AuthController). Les créneaux sont calculés ici, côté serveur, et
 * recalculés à l'envoi : un créneau passé ou inventé est refusé. Quantités,
 * stock et prix sont revérifiés par OrderModel, dans une transaction.
 */
final class OrderController
{
    /** Fuseau des concessions : les créneaux sont des heures de Lyon. */
    private const TIMEZONE = 'Europe/Paris';

    /** Créneaux d'une journée, [heure de début, heure de fin]. */
    private const SLOT_HOURS = [[10, 12], [14, 16], [16, 18]];

    /** Délai de préparation : un créneau commence au plus tôt 2 h après la commande. */
    private const PREPARATION_HOURS = 2;

    /** Nombre de créneaux proposés (maquette : 4). */
    private const SLOT_COUNT = 4;

    /** Nombre de jours examinés pour trouver ces créneaux. */
    private const DAYS_AHEAD = 7;

    /** Jour de fermeture, au format ISO de date('N') : 7 = dimanche. */
    private const CLOSED_DAY = 7;

    /** Format de l'identifiant d'un créneau, par exemple « 2026-10-21T16:00 ». */
    private const SLOT_ID = 'Y-m-d\TH:i';

    /** Nombre maximal de lignes d'une commande (comme CartController). */
    private const MAX_LINES = 50;

    /** Quantité maximale d'une ligne (comme MAX_QUANTITY dans front/src/data/cart.js). */
    private const MAX_QUANTITY = 10;

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
     * GET /api/checkout
     *
     * Répond { customer, dealerships, slots } : les coordonnées du compte
     * connecté, les concessions et les prochains créneaux de retrait.
     * 401 si personne n'est connecté.
     */
    public function checkout(): void
    {
        $customer = $this->requireCustomer();

        Response::json([
            'customer'    => [
                'firstName' => $customer['firstName'],
                'lastName'  => $customer['lastName'],
                'email'     => $customer['email'],
                'phone'     => $customer['phone'],
            ],
            'dealerships' => $this->dealerships->findAll(),
            'slots'       => array_map([self::class, 'toPublicSlot'], self::offeredSlots(self::now())),
        ]);
    }

    /**
     * POST /api/orders, corps JSON
     * { dealershipId, slot, items: [{ variantId, quantity }] }.
     *
     * Enregistre la commande et baisse les stocks : répond { order }, en 201.
     * 401 si personne n'est connecté ; 400 si les articles sont invalides ;
     * 422 (clé « champs ») si la concession ou le créneau est refusé ;
     * 409 (clé « indisponibles », identifiants de variantes) si un article
     * manque : rien n'est alors enregistré.
     *
     * @param Request $request Requête entrante.
     */
    public function create(Request $request): void
    {
        $customer = $this->requireCustomer();
        $body     = $request->corps();

        $items = self::validateItems($body['items'] ?? null);

        if ($items === null) {
            Response::erreur('Articles de la commande invalides', 400);
        }

        $dealershipId = filter_var($body['dealershipId'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $dealership   = $dealershipId === false ? null : $this->dealerships->findById($dealershipId);
        $slot         = self::findSlot($body['slot'] ?? null);

        $errors = [];
        if ($dealership === null) {
            $errors['dealership'] = 'Choisissez une concession de retrait.';
        }
        if ($slot === null) {
            $errors['slot'] = 'Ce créneau n\'est plus disponible : choisissez-en un autre.';
        }
        if ($errors !== []) {
            Response::json(['erreur' => 'Certains choix sont à corriger.', 'champs' => $errors], 422);
        }

        $result = $this->orders->create($customer['id'], $dealership['id'], $slot['start'], $slot['end'], $items);

        if ($result['orderId'] === null) {
            Response::json([
                'erreur'        => 'Certains articles ne sont plus disponibles en quantité suffisante.',
                'indisponibles' => $result['unavailable'],
            ], 409);
        }

        Response::json(['order' => $this->orders->findById($result['orderId'])], 201);
    }

    /**
     * Compte connecté, relu en base. Répond 401 (et s'arrête) s'il n'y en a pas.
     *
     * @return array{id:int, firstName:string, lastName:string, email:string, phone:string, role:string}
     */
    private function requireCustomer(): array
    {
        $id       = $_SESSION['customerId'] ?? null;
        $customer = is_int($id) ? $this->customers->findById($id) : null;

        if ($customer === null) {
            Response::erreur('Connectez-vous pour valider votre commande.', 401);
        }

        return $customer;
    }

    /**
     * Valide les articles reçus : une liste non vide d'au plus MAX_LINES
     * lignes { variantId > 0, quantity entre 1 et MAX_QUANTITY }, sans
     * variante en double.
     *
     * @param mixed $items Valeur « items » du corps JSON.
     *
     * @return array<int, array{variantId:int, quantity:int}>|null null si invalide.
     */
    private static function validateItems(mixed $items): ?array
    {
        if (!is_array($items) || !array_is_list($items) || $items === [] || count($items) > self::MAX_LINES) {
            return null;
        }

        $valid = [];

        for ($i = 0; $i < count($items); $i++) {
            $item = $items[$i];

            if (!is_array($item)) {
                return null;
            }

            // filter_var refuse « 12abc », « -3 » ou « 0 », que (int) aurait acceptés.
            $variantId = filter_var($item['variantId'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $quantity  = filter_var(
                $item['quantity'] ?? null,
                FILTER_VALIDATE_INT,
                ['options' => ['min_range' => 1, 'max_range' => self::MAX_QUANTITY]],
            );

            if ($variantId === false || $quantity === false) {
                return null;
            }

            $valid[] = ['variantId' => $variantId, 'quantity' => $quantity];
        }

        $variantIds = array_column($valid, 'variantId');

        return count(array_unique($variantIds)) === count($variantIds) ? $valid : null;
    }

    /**
     * Retrouve un créneau parmi ceux proposés à l'instant.
     *
     * @param mixed $slotId Identifiant reçu, par exemple « 2026-10-21T16:00 ».
     *
     * @return array{id:string, start:DateTimeImmutable, end:DateTimeImmutable}|null
     *         null si ce créneau n'est pas (ou plus) proposé.
     */
    private static function findSlot(mixed $slotId): ?array
    {
        if (!is_string($slotId)) {
            return null;
        }

        $matches = array_values(array_filter(
            self::offeredSlots(self::now()),
            static fn (array $slot): bool => $slot['id'] === $slotId,
        ));

        return $matches[0] ?? null;
    }

    /**
     * Prochains créneaux de retrait : ceux qui commencent au moins
     * PREPARATION_HOURS après $now, hors jour de fermeture.
     *
     * @param DateTimeImmutable $now Instant de référence, dans le fuseau des concessions.
     *
     * @return array<int, array{id:string, start:DateTimeImmutable, end:DateTimeImmutable, dayOffset:int}>
     */
    private static function offeredSlots(DateTimeImmutable $now): array
    {
        $earliest = $now->modify('+' . self::PREPARATION_HOURS . ' hours');
        $today    = $now->setTime(0, 0);
        $slots    = [];

        for ($day = 0; $day < self::DAYS_AHEAD && count($slots) < self::SLOT_COUNT; $day++) {
            $date = $today->modify("+{$day} days");

            if ((int) $date->format('N') === self::CLOSED_DAY) {
                continue;
            }

            for ($i = 0; $i < count(self::SLOT_HOURS) && count($slots) < self::SLOT_COUNT; $i++) {
                $start = $date->setTime(self::SLOT_HOURS[$i][0], 0);

                if ($start < $earliest) {
                    continue;
                }

                $slots[] = [
                    'id'        => $start->format(self::SLOT_ID),
                    'start'     => $start,
                    'end'       => $date->setTime(self::SLOT_HOURS[$i][1], 0),
                    'dayOffset' => $day,
                ];
            }
        }

        return $slots;
    }

    /**
     * Créneau tel qu'il est envoyé au navigateur : le front en fait le
     * libellé (« Auj. 16 h – 18 h », « Demain 10 h – 12 h »…).
     *
     * @param array{id:string, start:DateTimeImmutable, end:DateTimeImmutable, dayOffset:int} $slot
     *
     * @return array{id:string, date:string, dayOffset:int, startHour:int, endHour:int}
     *         dayOffset : 0 aujourd'hui, 1 demain…
     */
    private static function toPublicSlot(array $slot): array
    {
        return [
            'id'        => $slot['id'],
            'date'      => $slot['start']->format('Y-m-d'),
            'dayOffset' => $slot['dayOffset'],
            'startHour' => (int) $slot['start']->format('G'),
            'endHour'   => (int) $slot['end']->format('G'),
        ];
    }

    /**
     * @return DateTimeImmutable L'instant présent, à l'heure de Lyon.
     */
    private static function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone(self::TIMEZONE));
    }
}
