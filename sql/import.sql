-- ---------------------------------------------------------------------------
-- Honda Moto Lyon Centre — click & collect : tables et jeu de données
--
-- Ce script ne crée PAS de base de données : il ajoute ses tables à une base
-- existante, la vôtre. Depuis phpMyAdmin, sélectionnez d'abord votre base dans
-- la colonne de gauche, puis importez ce fichier depuis l'onglet « Importer ».
--
-- Modèle (lot 0, voir analyse-user-stories.md) :
--
--     category 1 ── n product 1 ── n variant
--                           └── n product_feature
--
--     customer : comptes clients et administrateurs (US CMD-c)
--
--     customer 1 ── n customer_order 1 ── n order_line n ── 1 variant
--     dealership 1 ── n customer_order          (US CMD-a)
--
--     variant 1 ── n stock_movement n ── 0..1 customer_order   (US STK-a)
--     customer_order 1 ── n order_event n ── 0..1 customer      (US PIL-b)
--
-- Chaque produit a AU MOINS une variante (taille, coloris, garniture… ou
-- « Unique »). C'est la variante qui porte la référence et le stock : le
-- panier, les commandes et les stocks s'appuieront sur variant.id, et l'arrivée
-- des variantes (OPT-b) ne demandera pas de réécrire ces tables.
--
-- 18 produits répartis sur 4 catégories : de quoi remplir 2 pages de 12, comme
-- sur la maquette du catalogue (écran 1, DEC-b). Chaque catégorie est découpée
-- en sous-catégories : les 4 de Collection Honda reprennent la maquette des
-- catégories (écran 3, DEC-a), les autres suivent le même principe.
--
-- L'import est rejouable : les tables sont supprimées avant d'être recréées.
-- ATTENTION : les anciennes tables du starter (film, genre) sont supprimées.
-- ---------------------------------------------------------------------------

-- Le jeu de caractères de la connexion est fixé explicitement : sans cela,
-- un client configuré en latin1 enregistrerait les accents en double encodage.
SET NAMES utf8mb4;

-- Ordre de suppression : d'abord les tables qui dépendent des autres.
DROP TABLE IF EXISTS film;
DROP TABLE IF EXISTS genre;
DROP TABLE IF EXISTS order_event;
DROP TABLE IF EXISTS stock_movement;
DROP TABLE IF EXISTS order_line;
DROP TABLE IF EXISTS customer_order;
DROP TABLE IF EXISTS dealership;
DROP TABLE IF EXISTS customer;
DROP TABLE IF EXISTS product_feature;
DROP TABLE IF EXISTS variant;
DROP TABLE IF EXISTS product;
DROP TABLE IF EXISTS category;

-- ---------------------------------------------------------------------------
-- Catégories
--
-- parent_id porte les sous-catégories de DEC-a (T-shirts, Sweats… dans
-- Collection Honda). Une catégorie de premier niveau a parent_id NULL.
-- Un seul niveau de sous-catégorie : une sous-catégorie n'a pas d'enfant.
-- Un produit est rangé dans la catégorie la plus précise ; une catégorie
-- parente affiche aussi les produits de ses sous-catégories.
-- description est la phrase affichée sous le titre de la page catégorie.
-- ---------------------------------------------------------------------------
CREATE TABLE category (
    id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    parent_id   TINYINT UNSIGNED     NULL,
    name        VARCHAR(60)      NOT NULL,
    slug        VARCHAR(60)      NOT NULL,
    description VARCHAR(160)         NULL,
    position    TINYINT UNSIGNED NOT NULL DEFAULT 0,

    PRIMARY KEY (id),
    UNIQUE KEY uq_category_slug (slug),
    KEY idx_category_parent (parent_id),

    CONSTRAINT fk_category_parent
        FOREIGN KEY (parent_id) REFERENCES category (id)
        ON DELETE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Produits
--
-- price est le prix de vente TTC, en euros. DECIMAL et non FLOAT : un prix ne
-- doit jamais subir d'arrondi binaire (0,1 + 0,2 ≠ 0,3 en FLOAT).
-- image est un nom de fichier de front/public/images/produits/, ou NULL tant
-- qu'aucune photo n'est disponible.
-- Les index sur price et created_at servent les tris du catalogue.
-- ---------------------------------------------------------------------------
CREATE TABLE product (
    id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_id TINYINT UNSIGNED  NOT NULL,
    name        VARCHAR(120)      NOT NULL,
    slug        VARCHAR(120)      NOT NULL,
    description TEXT                  NULL,
    price       DECIMAL(8,2)      NOT NULL,
    image       VARCHAR(120)          NULL,
    is_active   TINYINT(1)        NOT NULL DEFAULT 1,
    created_at  DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_product_slug (slug),
    KEY idx_product_category (category_id),
    KEY idx_product_price (price),
    KEY idx_product_created (created_at),

    CONSTRAINT fk_product_category
        FOREIGN KEY (category_id) REFERENCES category (id)
        ON DELETE RESTRICT,
    CONSTRAINT chk_product_price CHECK (price >= 0)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Variantes
--
-- La référence et le stock sont portés ici, jamais par le produit.
-- stock est UNSIGNED : MySQL refuse une valeur négative, dernier rempart
-- contre la survente si une écriture oubliait de vérifier le stock.
-- ---------------------------------------------------------------------------
CREATE TABLE variant (
    id         SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_id SMALLINT UNSIGNED NOT NULL,
    reference  VARCHAR(40)       NOT NULL,
    label      VARCHAR(60)       NOT NULL,
    stock      INT UNSIGNED      NOT NULL DEFAULT 0,
    position   TINYINT UNSIGNED  NOT NULL DEFAULT 0,

    PRIMARY KEY (id),
    UNIQUE KEY uq_variant_reference (reference),
    UNIQUE KEY uq_variant_product_label (product_id, label),

    CONSTRAINT fk_variant_product
        FOREIGN KEY (product_id) REFERENCES product (id)
        ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Caractéristiques (US DEC-c)
--
-- Lignes « libellé : valeur » propres à un produit (Matière, Contenance…).
-- Un produit peut n'en avoir aucune : la fiche masque alors le bloc.
-- position fixe l'ordre d'affichage.
-- ---------------------------------------------------------------------------
CREATE TABLE product_feature (
    id         SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_id SMALLINT UNSIGNED NOT NULL,
    label      VARCHAR(40)       NOT NULL,
    value      VARCHAR(160)      NOT NULL,
    position   TINYINT UNSIGNED  NOT NULL DEFAULT 0,

    PRIMARY KEY (id),
    KEY idx_feature_product (product_id, position),

    CONSTRAINT fk_feature_product
        FOREIGN KEY (product_id) REFERENCES product (id)
        ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Comptes (US CMD-c)
--
-- Une seule table pour les clients et l'administration : role distingue les
-- deux. Le rôle est lu en base et rangé en session côté serveur, jamais
-- confié au navigateur.
-- password_hash contient le résultat de password_hash() (algorithme, sel et
-- empreinte) : le mot de passe lui-même n'est jamais enregistré.
-- email est unique : c'est l'identifiant de connexion. Il est enregistré en
-- minuscules par l'API.
-- ---------------------------------------------------------------------------
CREATE TABLE customer (
    id            INT UNSIGNED              NOT NULL AUTO_INCREMENT,
    first_name    VARCHAR(60)               NOT NULL,
    last_name     VARCHAR(60)               NOT NULL,
    email         VARCHAR(190)              NOT NULL,
    phone         VARCHAR(20)               NOT NULL,
    password_hash VARCHAR(255)              NOT NULL,
    role          ENUM('customer', 'admin') NOT NULL DEFAULT 'customer',
    created_at    DATETIME                  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_customer_email (email)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Concessions de retrait (US CMD-a)
--
-- short_name sert au récapitulatif (« Retrait à Lyon Centre ») ;
-- hours_label est la mention affichée sous l'adresse.
-- ---------------------------------------------------------------------------
CREATE TABLE dealership (
    id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(80)      NOT NULL,
    short_name  VARCHAR(40)      NOT NULL,
    address     VARCHAR(160)     NOT NULL,
    hours_label VARCHAR(60)      NOT NULL,
    position    TINYINT UNSIGNED NOT NULL DEFAULT 0,

    PRIMARY KEY (id)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Commandes (US CMD-a)
--
-- « order » est un mot réservé de SQL : la table s'appelle customer_order.
-- Le paiement se fait toujours sur place, au retrait : aucune colonne ne le
-- décrit. Le créneau de retrait est enregistré par son début et sa fin.
-- status suit le cycle en_cours → disponible → retiree, ou annulee.
-- total est figé à la commande : un prix modifié ensuite ne le change pas.
-- ---------------------------------------------------------------------------
CREATE TABLE customer_order (
    id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    customer_id   INT UNSIGNED     NOT NULL,
    dealership_id TINYINT UNSIGNED NOT NULL,
    pickup_start  DATETIME         NOT NULL,
    pickup_end    DATETIME         NOT NULL,
    status        ENUM('en_cours', 'disponible', 'retiree', 'annulee') NOT NULL DEFAULT 'en_cours',
    total         DECIMAL(10,2)    NOT NULL DEFAULT 0,
    created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_order_customer (customer_id, created_at),
    KEY idx_order_status (status),

    CONSTRAINT fk_order_customer
        FOREIGN KEY (customer_id) REFERENCES customer (id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_order_dealership
        FOREIGN KEY (dealership_id) REFERENCES dealership (id)
        ON DELETE RESTRICT,
    CONSTRAINT chk_order_total CHECK (total >= 0),
    CONSTRAINT chk_order_pickup CHECK (pickup_end > pickup_start)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Lignes de commande (US CMD-a)
--
-- Nom, variante, référence et prix unitaire sont COPIÉS au moment de la
-- commande : la commande reste lisible et juste même si le produit change de
-- prix ou disparaît. variant_id passe alors à NULL (ON DELETE SET NULL).
-- ---------------------------------------------------------------------------
CREATE TABLE order_line (
    id            INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    order_id      INT UNSIGNED      NOT NULL,
    variant_id    SMALLINT UNSIGNED     NULL,
    product_name  VARCHAR(120)      NOT NULL,
    variant_label VARCHAR(60)       NOT NULL,
    reference     VARCHAR(40)       NOT NULL,
    unit_price    DECIMAL(8,2)      NOT NULL,
    quantity      SMALLINT UNSIGNED NOT NULL,

    PRIMARY KEY (id),
    KEY idx_line_order (order_id),
    KEY idx_line_variant (variant_id),

    CONSTRAINT fk_line_order
        FOREIGN KEY (order_id) REFERENCES customer_order (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_line_variant
        FOREIGN KEY (variant_id) REFERENCES variant (id)
        ON DELETE SET NULL,
    CONSTRAINT chk_line_price CHECK (unit_price >= 0),
    CONSTRAINT chk_line_quantity CHECK (quantity > 0)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Journal des mouvements de stock (US STK-a)
--
-- Une ligne par variante et par mouvement, écrite dans la même transaction
-- que la baisse (commande) ou le recrédit (annulation, PIL-b) : le journal
-- ne peut pas contredire le stock. quantity est signée : -2 pour 2 unités
-- vendues, +2 pour 2 unités recréditées. stock_after est le stock de la
-- variante juste après le mouvement, pour retracer son évolution.
-- Le journal survit à la suppression de la commande (order_id à NULL).
-- ---------------------------------------------------------------------------
CREATE TABLE stock_movement (
    id          INT UNSIGNED                      NOT NULL AUTO_INCREMENT,
    variant_id  SMALLINT UNSIGNED                 NOT NULL,
    order_id    INT UNSIGNED                          NULL,
    reason      ENUM('commande', 'annulation')    NOT NULL,
    quantity    INT                               NOT NULL,
    stock_after INT UNSIGNED                      NOT NULL,
    created_at  DATETIME                          NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_movement_variant (variant_id, created_at),
    KEY idx_movement_order (order_id),

    CONSTRAINT fk_movement_variant
        FOREIGN KEY (variant_id) REFERENCES variant (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_movement_order
        FOREIGN KEY (order_id) REFERENCES customer_order (id)
        ON DELETE SET NULL,
    CONSTRAINT chk_movement_quantity CHECK (quantity <> 0)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Journal des statuts de commande (US PIL-b)
--
-- Une ligne à la création de la commande (« en_cours », admin_id NULL : c'est
-- le client qui commande), puis une à chaque changement de statut fait au
-- back-office, écrite dans la même transaction que ce changement. admin_id
-- est l'administrateur qui l'a fait ; il passe à NULL si son compte est
-- supprimé, le journal reste.
-- ---------------------------------------------------------------------------
CREATE TABLE order_event (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id   INT UNSIGNED NOT NULL,
    status     ENUM('en_cours', 'disponible', 'retiree', 'annulee') NOT NULL,
    admin_id   INT UNSIGNED     NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_event_order (order_id, created_at),

    CONSTRAINT fk_event_order
        FOREIGN KEY (order_id) REFERENCES customer_order (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_event_admin
        FOREIGN KEY (admin_id) REFERENCES customer (id)
        ON DELETE SET NULL
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Jeu de données
-- ---------------------------------------------------------------------------
-- Les catégories parentes sont insérées avant leurs sous-catégories, sinon la
-- clé étrangère parent_id serait refusée.
INSERT INTO category (id, parent_id, name, slug, description, position) VALUES
    (1, NULL, 'Bagagerie',             'bagagerie',
      'Top box et sacoches d''origine pour partir équipé.',                          1),
    (2, NULL, 'Équipement et confort', 'equipement-confort',
      'Équipement du motard et accessoires de confort pour rouler en toute saison.', 2),
    (3, NULL, 'Entretien',             'entretien',
      'Huiles, filtres et produits d''entretien d''origine Honda.',                  3),
    (4, NULL, 'Collection Honda',      'collection-honda',
      'Vêtements et objets de la collection officielle Honda.',                     4),
    (5,    4, 'T-shirts',              't-shirts',
      'T-shirts officiels de la collection Honda.',                                  1),
    (6,    4, 'Sweats',                'sweats',
      'Sweats à capuche de la collection Honda.',                                    2),
    (7,    4, 'Casquettes',            'casquettes',
      'Casquettes brodées aux couleurs de Honda.',                                   3),
    (8,    4, 'Accessoires',           'accessoires',
      'Petits objets et cadeaux de la collection Honda.',                            4),
    (9,    1, 'Top box',               'top-box',
      'Top box rigides à fixer sur le porte-bagages.',                               1),
    (10,   1, 'Sacoches',              'sacoches',
      'Sacoches de réservoir et de selle, souples et étanches.',                     2),
    (11,   2, 'Blousons et pantalons', 'blousons-pantalons',
      'Vêtements de protection homologués pour la route et le tout-terrain.',        1),
    (12,   2, 'Confort de conduite',   'confort-conduite',
      'Selles et poignées chauffantes pour rouler plus longtemps.',                  2),
    (13,   3, 'Huiles et filtres',     'huiles-filtres',
      'Huiles moteur et filtres d''origine pour la vidange.',                        1),
    (14,   3, 'Liquides et lubrifiants', 'liquides-lubrifiants',
      'Liquide de refroidissement et entretien de la chaîne.',                       2);

-- Les dates de création sont échelonnées pour que le tri « Nouveautés » soit
-- visible. Les produits 15, 17 et 18 n'ont pas encore de photo (image NULL).
-- Chaque produit est rangé dans sa sous-catégorie (5 à 14).
INSERT INTO product (id, category_id, name, slug, description, price, image, created_at) VALUES
    ( 1,  8, 'Porte-clés Rubber Wing',            'porte-cles-rubber-wing',
      'Porte-clés souple en caoutchouc aux couleurs de l''aile Honda.',
        6.90, 'porte-cles-rubber-wing.jpg',         '2026-09-01 10:00:00'),
    ( 2, 14, 'Liquide de refroidissement Type 2', 'liquide-refroidissement-type-2',
      'Liquide de refroidissement prêt à l''emploi, compatible avec tous les moteurs Honda.',
       10.50, 'liquide-refroidissement-type-2.png', '2026-09-02 10:00:00'),
    ( 3, 14, 'Lubrifiant chaîne Pro Honda',       'lubrifiant-chaine-pro-honda',
      'Aérosol de graisse pour chaîne à joints toriques, anti-projections.',
       11.90, 'lubrifiant-chaine-pro-honda.png',    '2026-09-03 10:00:00'),
    ( 4, 13, 'Huile moteur Pro Honda 10W-30 MA',  'huile-pro-honda-10w30',
      'Huile moteur 4 temps semi-synthèse, norme JASO MA pour embrayage à bain d''huile.',
       16.90, 'huile-pro-honda-10w30.png',          '2026-09-04 10:00:00'),
    ( 5, 13, 'Cartouche filtre à huile',          'cartouche-filtre-huile',
      'Filtre à huile d''origine Honda, à remplacer à chaque vidange.',
       19.50, 'cartouche-filtre-huile.png',         '2026-09-05 10:00:00'),
    ( 6,  7, 'Casquette Factory',                 'casquette-factory',
      'Casquette réglable brodée de l''aile Honda.',
       24.90, 'casquette-factory.jpg',              '2026-09-06 10:00:00'),
    ( 7,  5, 'T-shirt CBR Fireblade',             'tshirt-cbr-fireblade',
      'T-shirt officiel blanc 100 % coton (200 g/m²), grand logo CBR Fireblade sur la poitrine en hommage à la sportive née en 1992.',
       29.90, 'tshirt-cbr-fireblade.png',           '2026-09-07 10:00:00'),
    ( 8,  5, 'T-shirt Tribute CB1000F',           'tshirt-tribute-cb1000f',
      'T-shirt gris chiné aux bandes tricolores de la CB1000F.',
       39.90, 'tshirt-tribute-cb1000f.jpg',         '2026-09-08 10:00:00'),
    ( 9,  5, 'T-shirt Capsule',                   'tshirt-capsule',
      'T-shirt camouflage gris de la collection Capsule.',
       39.90, 'tshirt-capsule.jpg',                 '2026-09-09 10:00:00'),
    (10,  6, 'Sweat à capuche Monkey',            'sweat-capuche-monkey',
      'Sweat à capuche moutarde illustré de la Honda Monkey.',
       58.90, 'sweat-capuche-monkey.jpg',           '2026-09-10 10:00:00'),
    (11, 11, 'Pantalon MX',                       'pantalon-mx',
      'Pantalon de motocross renforcé aux genoux, coupe ajustée.',
      129.90, 'pantalon-mx.jpg',                    '2026-09-11 10:00:00'),
    (12, 10, 'Sacoche de réservoir 4,5 L',        'sacoche-reservoir-4-5l',
      'Sacoche de réservoir étanche 4,5 L à fixation rapide.',
      146.90, 'sacoche-reservoir-4-5l.jpg',         '2026-09-12 10:00:00'),
    (13, 11, 'Blouson cuir Maine',                'blouson-cuir-maine',
      'Blouson en cuir véritable au look vintage, coupe motard et bandes contrastées. Coques de protection CE amovibles aux épaules et aux coudes, poche pour dorsale, doublure thermique amovible.',
      379.90, 'blouson-cuir-maine.jpg',             '2026-09-13 10:00:00'),
    (14,  9, 'Smart Top Box 50 L',                'smart-top-box-50l',
      'Top box 50 L à ouverture sans clé, verrouillée avec la Smart Key du X-ADV. Livrée avec dosseret pour le confort du passager.',
      490.00, 'smart-top-box-50l.png',              '2026-09-14 10:00:00'),
    (15,  9, 'Kit top box aluminium 42 L',        'kit-top-box-aluminium-42l',
      'Top box en aluminium brossé 42 L avec platine de fixation.',
      399.00, NULL,                                 '2026-09-15 10:00:00'),
    (16, 12, 'Poignées chauffantes',              'poignees-chauffantes',
      'Poignées chauffantes d''origine, 5 niveaux de chauffe. X-ADV 750 (2017-2020).',
      311.90, 'poignees-chauffantes.jpg',           '2026-09-16 10:00:00'),
    (17, 12, 'Selle confort',                     'selle-confort',
      'Selle à mousse haute densité pour les longs trajets.',
      249.00, NULL,                                 '2026-09-17 10:00:00'),
    (18, 10, 'Sacoche de selle 10 L',             'sacoche-selle-10l',
      'Sacoche de selle extensible 10 L, sangles de fixation incluses.',
      159.90, NULL,                                 '2026-09-18 10:00:00');

-- Une variante « Unique » pour les produits sans déclinaison, plusieurs pour
-- les vêtements (tailles), la casquette (coloris) et la top box (garnitures).
INSERT INTO variant (product_id, reference, label, stock, position) VALUES
    ( 1, 'HM-PCL-RW',       'Unique',     40, 1),
    ( 2, 'HM-LRF-T2',       '1 L',        25, 1),
    ( 3, 'HM-LUB-CH',       '400 ml',     30, 1),
    ( 4, 'HM-HUI-1030-1L',  '1 L',        60, 1),
    ( 4, 'HM-HUI-1030-4L',  '4 L',        12, 2),
    ( 5, 'HM-FIL-HU',       'Unique',     18, 1),
    ( 6, 'HM-CAS-FAC-RGE',  'Rouge',       0, 1),
    ( 6, 'HM-CAS-FAC-NOI',  'Noir',        9, 2),
    ( 7, 'HM-TSH-CBR-S',    'Taille S',    4, 1),
    ( 7, 'HM-TSH-CBR-M',    'Taille M',    6, 2),
    ( 7, 'HM-TSH-CBR-L',    'Taille L',    5, 3),
    ( 7, 'HM-TSH-CBR-XL',   'Taille XL',   2, 4),
    ( 8, 'HM-TSH-TRB-S',    'Taille S',    3, 1),
    ( 8, 'HM-TSH-TRB-M',    'Taille M',    5, 2),
    ( 8, 'HM-TSH-TRB-L',    'Taille L',    7, 3),
    ( 8, 'HM-TSH-TRB-XL',   'Taille XL',   1, 4),
    ( 9, 'HM-TSH-CAP-S',    'Taille S',    2, 1),
    ( 9, 'HM-TSH-CAP-M',    'Taille M',    4, 2),
    ( 9, 'HM-TSH-CAP-L',    'Taille L',    3, 3),
    (10, 'HM-SWT-MKY-S',    'Taille S',    2, 1),
    (10, 'HM-SWT-MKY-M',    'Taille M',    5, 2),
    (10, 'HM-SWT-MKY-L',    'Taille L',    4, 3),
    (10, 'HM-SWT-MKY-XL',   'Taille XL',   2, 4),
    (11, 'HM-PMX-30',       'Taille 30',   2, 1),
    (11, 'HM-PMX-32',       'Taille 32',   3, 2),
    (11, 'HM-PMX-34',       'Taille 34',   2, 3),
    (12, 'HM-SAC-RES-45',   'Unique',      6, 1),
    (13, 'HM-BLC-MAI-S',    'Taille S',    1, 1),
    (13, 'HM-BLC-MAI-M',    'Taille M',    3, 2),
    (13, 'HM-BLC-MAI-L',    'Taille L',    2, 3),
    (13, 'HM-BLC-MAI-XL',   'Taille XL',   1, 4),
    (14, 'HM-STB-50-ALU',   'Aluminium',   4, 1),
    (14, 'HM-STB-50-ARG',   'Argent',      2, 2),
    (14, 'HM-STB-50-NOI',   'Noir',        3, 3),
    (15, 'HM-KTB-ALU-42',   'Unique',      0, 1),
    (16, 'HM-POI-CHA-XADV', 'Unique',      5, 1),
    (17, 'HM-SEL-CNF',      'Unique',      2, 1),
    (18, 'HM-SAC-SEL-10',   'Unique',      7, 1);

-- Caractéristiques : celles du blouson reprennent la maquette (écran 2).
INSERT INTO product_feature (product_id, label, value, position) VALUES
    ( 4, 'Viscosité',     '10W-30',                                       1),
    ( 4, 'Norme',         'JASO MA, API SL',                              2),
    ( 4, 'Type',          'Semi-synthèse, moteurs 4 temps',               3),
    ( 5, 'Compatibilité', 'CB500, NC750X, X-ADV, Africa Twin',            1),
    ( 5, 'Entretien',     'À remplacer à chaque vidange',                 2),
    ( 7, 'Matière',       '100 % coton, 200 g/m²',                        1),
    ( 7, 'Coupe',         'Droite, col rond',                             2),
    ( 7, 'Entretien',     'Lavage à 30 °C, sur l''envers',                3),
    (10, 'Matière',       '80 % coton, 20 % polyester',                   1),
    (10, 'Coupe',         'Capuche doublée, poche kangourou',             2),
    (12, 'Contenance',    '4,5 L',                                        1),
    (12, 'Fixation',      'Anneau de réservoir à verrouillage rapide',    2),
    (12, 'Étanchéité',    'Housse de pluie fournie',                      3),
    (13, 'Matière',       'Cuir véritable, doublure thermique amovible',  1),
    (13, 'Protections',   'Coques CE épaules et coudes, poche dorsale',   2),
    (13, 'Homologation',  'CE EN 1621-1 niveau 1',                        3),
    (13, 'Tailles',       'S à XL',                                       4),
    (14, 'Contenance',    '50 L, deux casques jet',                       1),
    (14, 'Ouverture',     'Sans clé, avec la Smart Key du X-ADV',         2),
    (14, 'Fourni avec',   'Dosseret passager',                            3),
    (16, 'Compatibilité', 'X-ADV 750 (2017-2020)',                        1),
    (16, 'Réglage',       '5 niveaux de chauffe',                         2);

-- Comptes de démonstration (voir README) : alice@exemple.fr / azerty et
-- admin@honda-lyon.fr / motdepasse. Les empreintes ont été produites par
-- password_hash() ; password_verify() les reconnaît.
INSERT INTO customer (id, first_name, last_name, email, phone, password_hash, role) VALUES
    (1, 'Alice', 'Martin', 'alice@exemple.fr',    '0601020304',
      '$2y$12$KhZok8GMkFs9fnyzIr.e4epTlmI4nqEg44GokNMrW4EiMJf.8NH7K', 'customer'),
    (2, 'Honda', 'Lyon',   'admin@honda-lyon.fr', '0478000000',
      '$2y$12$EXfknxoF6Jj9XfazOLOsduOJAV7VXRAQHDMNT/D2am1QrYnV3mwxC', 'admin');

-- Concessions de la maquette de validation de commande (écran 6).
INSERT INTO dealership (id, name, short_name, address, hours_label, position) VALUES
    (1, 'Honda Moto Lyon Centre',  'Lyon Centre',  '12 rue de la République, 69002 Lyon',
      'ouvert jusqu''à 19 h',    1),
    (2, 'Honda Moto Villeurbanne', 'Villeurbanne', '45 cours Émile Zola, 69100 Villeurbanne',
      'ouvert jusqu''à 18 h 30', 2);
