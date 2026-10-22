<?php

declare(strict_types=1);

namespace App\Controller;

use App\Core\Request;
use App\Core\Response;
use App\Model\CustomerModel;
use App\Model\DealershipModel;
use App\Model\OrderModel;
use App\Model\PromoCodeModel;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Validation de la commande (US CMD-a) : concession, créneau de retrait et
 * paiement sur place. Historique des commandes du client (US SUI-c) et
 * détail d'une commande, pour la commander à nouveau (US SUI-a).
 *
 * Les routes exigent un compte connecté (identifiant rangé en session
 * par AuthController). Les créneaux sont calculés ici, côté serveur, et
 * recalculés à l'envoi : un créneau passé ou inventé est refusé. Quantités,
 * stock, prix et options (US OPT-a) sont revérifiés par OrderModel, dans une
 * transaction, comme le code promo (US PRO-a) : son statut est revérifié ici,
 * son montant minimum et sa dernière utilisation dans la transaction.
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

    /** Nombre maximal d'options d'une ligne (comme MAX_OPTIONS dans front/src/data/cart.js). */
    private const MAX_OPTIONS = 10;

    /**
     * Périodes de l'historique (US SUI-c) : nombre de mois, ou null pour
     * toutes les commandes. Clés : valeurs acceptées du paramètre period.
     */
    private const PERIODS = ['3' => 3, '6' => 6, '12' => 12, 'all' => null];

    /** Période par défaut (maquette : « 6 derniers mois »). */
    private const DEFAULT_PERIOD = '6';

    /** Accès aux comptes. */
    private CustomerModel $customers;

    /** Accès aux concessions. */
    private DealershipModel $dealerships;

    /** Accès aux commandes. */
    private OrderModel $orders;

    /** Accès aux codes promo. */
    private PromoCodeModel $promoCodes;

    /**
     * @param CustomerModel   $customers   Accès aux comptes.
     * @param DealershipModel $dealerships Accès aux concessions.
     * @param OrderModel      $orders      Accès aux commandes.
     * @param PromoCodeModel  $promoCodes  Accès aux codes promo.
     */
    public function __construct(
        CustomerModel $customers,
        DealershipModel $dealerships,
        OrderModel $orders,
        PromoCodeModel $promoCodes,
    ) {
        $this->customers   = $customers;
        $this->dealerships = $dealerships;
        $this->orders      = $orders;
        $this->promoCodes  = $promoCodes;
    }

    /**
     * GET /api/checkout
     *
     * Répond { customer, dealerships, slots } : les coordonnées du compte
     * connecté (avec sa concession préférée, US SUI-b, ou null), les
     * concessions et les prochains créneaux de retrait.
     * 401 si personne n'est connecté.
     */
    public function checkout(): void
    {
        $customer = $this->requireCustomer();

        Response::json([
            'customer'    => [
                'firstName'             => $customer['firstName'],
                'lastName'              => $customer['lastName'],
                'email'                 => $customer['email'],
                'phone'                 => $customer['phone'],
                'preferredDealershipId' => $customer['preferredDealershipId'],
            ],
            'dealerships' => $this->dealerships->findAll(),
            'slots'       => array_map([self::class, 'toPublicSlot'], self::offeredSlots(self::now())),
        ]);
    }

    /**
     * POST /api/orders, corps JSON
     * { dealershipId, slot, items: [{ variantId, quantity, optionIds }], promoCode }.
     * optionIds (US OPT-a) est facultatif : sans lui, la ligne n'a pas d'option.
     * promoCode (US PRO-a) est facultatif : null ou absent, pas de code.
     *
     * Enregistre la commande et baisse les stocks : répond { order }, en 201,
     * avec le code promo utilisé et sa remise (promoCode, discount).
     * 401 si personne n'est connecté ; 400 si les articles sont invalides ;
     * 422 (clé « champs ») si la concession ou le créneau est refusé, si
     * une option n'est pas (ou plus) proposée pour son article, ou si le code
     * promo est refusé (champs.promoCode : inconnu, pas actif, montant
     * minimum non atteint) : rien n'est alors enregistré ;
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

        $code         = CartController::normalizePromoCode($body['promoCode'] ?? null);
        $promoCode    = $code === '' ? null : $this->promoCodes->findByCode($code);
        $promoRefusal = $code === '' ? null : CartController::promoCodeRefusal($promoCode, $code);

        $errors = [];
        if ($dealership === null) {
            $errors['dealership'] = 'Choisissez une concession de retrait.';
        }
        if ($slot === null) {
            $errors['slot'] = 'Ce créneau n\'est plus disponible : choisissez-en un autre.';
        }
        if ($promoRefusal !== null) {
            $errors['promoCode'] = $promoRefusal;
        }
        if ($errors !== []) {
            Response::json(['erreur' => 'Certains choix sont à corriger.', 'champs' => $errors], 422);
        }

        $result = $this->orders->create($customer['id'], $dealership['id'], $slot['start'], $slot['end'], $items, $promoCode);

        if ($result['refusedPromo'] !== null) {
            Response::json([
                'erreur' => 'Le code promo ne peut pas être utilisé.',
                'champs' => ['promoCode' => self::promoRefusal($promoCode, $result['refusedPromo'])],
            ], 422);
        }

        if ($result['refusedOptions'] !== []) {
            Response::json([
                'erreur' => 'Certaines options ont changé.',
                'champs' => ['options' => 'Certaines options ne sont plus proposées : vérifiez votre panier.'],
            ], 422);
        }

        if ($result['orderId'] === null) {
            Response::json([
                'erreur'        => 'Certains articles ne sont plus disponibles en quantité suffisante.',
                'indisponibles' => $result['unavailable'],
            ], 409);
        }

        Response::json(['order' => $this->orders->findById($result['orderId'])], 201);
    }

    /**
     * GET /api/orders?period=6
     *
     * Historique du compte connecté (US SUI-c). Répond { orders, period } :
     * - orders : ses commandes passées dans la période, des plus récentes aux
     *   plus anciennes, avec leur concession, leurs lignes, le journal de
     *   leurs statuts (events, US PIL-b) et dayOffset (jour du créneau par
     *   rapport à aujourd'hui : 0 aujourd'hui, 1 demain, -1 hier…) ;
     * - period : la période appliquée (« 3 », « 6 », « 12 » derniers mois ou
     *   « all »), une valeur invalide étant remplacée par DEFAULT_PERIOD.
     *
     * Seules les commandes du compte en session sont lues : aucun identifiant
     * de client ne vient du navigateur. 401 si personne n'est connecté.
     *
     * @param Request $request Requête entrante.
     */
    public function history(Request $request): void
    {
        $customer = $this->requireCustomer('Connectez-vous pour consulter vos commandes.');

        $period = $request->parametre('period', self::DEFAULT_PERIOD);
        $period = array_key_exists($period, self::PERIODS) ? $period : self::DEFAULT_PERIOD;
        $months = self::PERIODS[$period];

        $since  = $months === null ? null : self::now()->modify("-{$months} months");
        $orders = $this->orders->findCustomerHistory($customer['id'], $since);
        $today  = self::now()->setTime(0, 0);

        Response::json([
            'orders' => array_map(
                static fn (array $order): array => $order + ['dayOffset' => self::dayOffset($order['pickupStart'], $today)],
                $orders,
            ),
            'period' => (string) $period,
        ]);
    }

    /**
     * GET /api/order?id=97
     *
     * Une commande du compte connecté (US SUI-a), pour la commander à
     * nouveau. Répond { order } : sa concession, ses lignes (prix figés à la
     * commande), le journal de ses statuts (events) et dayOffset, comme une
     * commande de l'historique. Le stock actuel des variantes est lu par
     * GET /api/cart (CartController), comme pour le panier.
     *
     * 401 si personne n'est connecté ; 400 si l'identifiant est invalide ;
     * 404 si la commande n'existe pas ou appartient à un autre compte : le
     * même code dans les deux cas, pour ne rien dire des commandes des autres.
     *
     * @param Request $request Requête entrante.
     */
    public function show(Request $request): void
    {
        $customer = $this->requireCustomer('Connectez-vous pour consulter vos commandes.');

        // filter_var refuse « 12abc », « -3 » ou « 0 », que (int) aurait acceptés.
        $id = filter_var($request->parametre('id'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);

        if ($id === false) {
            Response::erreur('Identifiant de commande invalide', 400);
        }

        $order = $this->orders->findCustomerOrder($id, $customer['id']);

        if ($order === null) {
            Response::erreur('Commande introuvable', 404);
        }

        Response::json(['order' => $order + ['dayOffset' => self::pickupDayOffset($order['pickupStart'])]]);
    }

    /**
     * Jour d'un retrait par rapport à aujourd'hui, à l'heure de Lyon. Sert
     * aussi à la dernière commande de l'espace personnel (AccountController,
     * US SUI-b).
     *
     * @param string $pickupStart Début du créneau, « 2026-10-21 16:00:00 ».
     *
     * @return int 0 aujourd'hui, 1 demain, -1 hier…
     */
    public static function pickupDayOffset(string $pickupStart): int
    {
        return self::dayOffset($pickupStart, self::now()->setTime(0, 0));
    }

    /**
     * Message d'un code promo refusé dans la transaction de la commande.
     *
     * @param array{code:string, minAmount:float} $promoCode
     * @param string                              $reason    « minimum » ou « epuise » (OrderModel::create).
     *
     * @return string Par exemple « Le code MOTARD20 s'applique dès 80,00 € d'achat. »
     */
    private static function promoRefusal(array $promoCode, string $reason): string
    {
        if ($reason === 'minimum') {
            return 'Le code ' . $promoCode['code'] . ' s\'applique dès '
                . number_format($promoCode['minAmount'], 2, ',', "\u{202F}") . "\u{00A0}€ d'achat.";
        }

        return 'Le code ' . $promoCode['code'] . ' a atteint son nombre maximal d\'utilisations.';
    }

    /**
     * Compte connecté, relu en base. Répond 401 (et s'arrête) s'il n'y en a pas.
     *
     * @param string $message Message du refus.
     *
     * @return array{id:int, firstName:string, lastName:string, email:string, phone:string, role:string,
     *               preferredDealershipId:?int}
     */
    private function requireCustomer(string $message = 'Connectez-vous pour valider votre commande.'): array
    {
        $id       = $_SESSION['customerId'] ?? null;
        $customer = is_int($id) ? $this->customers->findById($id) : null;

        if ($customer === null) {
            Response::erreur($message, 401);
        }

        return $customer;
    }

    /**
     * Valide les articles reçus : une liste non vide d'au plus MAX_LINES
     * lignes { variantId > 0, quantity entre 1 et MAX_QUANTITY, optionIds },
     * sans variante en double. Que chaque option appartienne bien au produit
     * de sa ligne, c'est OrderModel qui le vérifie en base.
     *
     * @param mixed $items Valeur « items » du corps JSON.
     *
     * @return array<int, array{variantId:int, quantity:int, optionIds:array<int, int>}>|null null si invalide.
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

            $optionIds = self::validateOptionIds($item['optionIds'] ?? []);

            if ($variantId === false || $quantity === false || $optionIds === null) {
                return null;
            }

            $valid[] = ['variantId' => $variantId, 'quantity' => $quantity, 'optionIds' => $optionIds];
        }

        $variantIds = array_column($valid, 'variantId');

        return count(array_unique($variantIds)) === count($variantIds) ? $valid : null;
    }

    /**
     * Valide les options d'une ligne (US OPT-a) : une liste d'au plus
     * MAX_OPTIONS identifiants > 0, sans doublon.
     *
     * @param mixed $optionIds Valeur « optionIds » d'une ligne.
     *
     * @return array<int, int>|null null si invalide.
     */
    private static function validateOptionIds(mixed $optionIds): ?array
    {
        if (!is_array($optionIds) || !array_is_list($optionIds) || count($optionIds) > self::MAX_OPTIONS) {
            return null;
        }

        // filter_var refuse « 12abc », « -3 » ou « 0 », que (int) aurait acceptés.
        $ids = array_map(
            static fn (mixed $id): int|false => filter_var($id, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]),
            $optionIds,
        );

        if (in_array(false, $ids, true) || count(array_unique($ids)) !== count($ids)) {
            return null;
        }

        return $ids;
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
     * @param string            $datetime Début du créneau, « 2026-10-21 16:00:00 ».
     * @param DateTimeImmutable $today    Aujourd'hui à minuit, à l'heure de Lyon.
     *
     * @return int Nombre de jours entre aujourd'hui et le créneau : 0
     *             aujourd'hui, 1 demain, -1 hier (comme AdminController).
     */
    private static function dayOffset(string $datetime, DateTimeImmutable $today): int
    {
        $day = new DateTimeImmutable(substr($datetime, 0, 10), $today->getTimezone());

        return (int) $today->diff($day)->format('%r%a');
    }

    /**
     * @return DateTimeImmutable L'instant présent, à l'heure de Lyon.
     */
    private static function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone(self::TIMEZONE));
    }
}
