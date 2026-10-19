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
-- Chaque produit a AU MOINS une variante (taille, coloris, garniture… ou
-- « Unique »). C'est la variante qui porte la référence et le stock : le
-- panier, les commandes et les stocks s'appuieront sur variant.id, et l'arrivée
-- des variantes (OPT-b) ne demandera pas de réécrire ces tables.
--
-- 18 produits répartis sur 4 catégories : de quoi remplir 2 pages de 12, comme
-- sur la maquette du catalogue (écran 1, DEC-b).
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
DROP TABLE IF EXISTS product_feature;
DROP TABLE IF EXISTS variant;
DROP TABLE IF EXISTS product;
DROP TABLE IF EXISTS category;

-- ---------------------------------------------------------------------------
-- Catégories
--
-- parent_id prépare les sous-catégories de DEC-a (T-shirts, Sweats… dans
-- Collection Honda). Une catégorie de premier niveau a parent_id NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE category (
    id        TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    parent_id TINYINT UNSIGNED     NULL,
    name      VARCHAR(60)      NOT NULL,
    slug      VARCHAR(60)      NOT NULL,
    position  TINYINT UNSIGNED NOT NULL DEFAULT 0,

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
-- Jeu de données
-- ---------------------------------------------------------------------------
INSERT INTO category (id, parent_id, name, slug, position) VALUES
    (1, NULL, 'Bagagerie',             'bagagerie',          1),
    (2, NULL, 'Équipement et confort', 'equipement-confort', 2),
    (3, NULL, 'Entretien',             'entretien',          3),
    (4, NULL, 'Collection Honda',      'collection-honda',   4);

-- Les dates de création sont échelonnées pour que le tri « Nouveautés » soit
-- visible. Les produits 15, 17 et 18 n'ont pas encore de photo (image NULL).
INSERT INTO product (id, category_id, name, slug, description, price, image, created_at) VALUES
    ( 1, 4, 'Porte-clés Rubber Wing',            'porte-cles-rubber-wing',
      'Porte-clés souple en caoutchouc aux couleurs de l''aile Honda.',
        6.90, 'porte-cles-rubber-wing.jpg',         '2026-09-01 10:00:00'),
    ( 2, 3, 'Liquide de refroidissement Type 2', 'liquide-refroidissement-type-2',
      'Liquide de refroidissement prêt à l''emploi, compatible avec tous les moteurs Honda.',
       10.50, 'liquide-refroidissement-type-2.png', '2026-09-02 10:00:00'),
    ( 3, 3, 'Lubrifiant chaîne Pro Honda',       'lubrifiant-chaine-pro-honda',
      'Aérosol de graisse pour chaîne à joints toriques, anti-projections.',
       11.90, 'lubrifiant-chaine-pro-honda.png',    '2026-09-03 10:00:00'),
    ( 4, 3, 'Huile moteur Pro Honda 10W-30 MA',  'huile-pro-honda-10w30',
      'Huile moteur 4 temps semi-synthèse, norme JASO MA pour embrayage à bain d''huile.',
       16.90, 'huile-pro-honda-10w30.png',          '2026-09-04 10:00:00'),
    ( 5, 3, 'Cartouche filtre à huile',          'cartouche-filtre-huile',
      'Filtre à huile d''origine Honda, à remplacer à chaque vidange.',
       19.50, 'cartouche-filtre-huile.png',         '2026-09-05 10:00:00'),
    ( 6, 4, 'Casquette Factory',                 'casquette-factory',
      'Casquette réglable brodée de l''aile Honda.',
       24.90, 'casquette-factory.jpg',              '2026-09-06 10:00:00'),
    ( 7, 4, 'T-shirt CBR Fireblade',             'tshirt-cbr-fireblade',
      'T-shirt officiel blanc 100 % coton (200 g/m²), grand logo CBR Fireblade sur la poitrine en hommage à la sportive née en 1992.',
       29.90, 'tshirt-cbr-fireblade.png',           '2026-09-07 10:00:00'),
    ( 8, 4, 'T-shirt Tribute CB1000F',           'tshirt-tribute-cb1000f',
      'T-shirt gris chiné aux bandes tricolores de la CB1000F.',
       39.90, 'tshirt-tribute-cb1000f.jpg',         '2026-09-08 10:00:00'),
    ( 9, 4, 'T-shirt Capsule',                   'tshirt-capsule',
      'T-shirt camouflage gris de la collection Capsule.',
       39.90, 'tshirt-capsule.jpg',                 '2026-09-09 10:00:00'),
    (10, 4, 'Sweat à capuche Monkey',            'sweat-capuche-monkey',
      'Sweat à capuche moutarde illustré de la Honda Monkey.',
       58.90, 'sweat-capuche-monkey.jpg',           '2026-09-10 10:00:00'),
    (11, 2, 'Pantalon MX',                       'pantalon-mx',
      'Pantalon de motocross renforcé aux genoux, coupe ajustée.',
      129.90, 'pantalon-mx.jpg',                    '2026-09-11 10:00:00'),
    (12, 1, 'Sacoche de réservoir 4,5 L',        'sacoche-reservoir-4-5l',
      'Sacoche de réservoir étanche 4,5 L à fixation rapide.',
      146.90, 'sacoche-reservoir-4-5l.jpg',         '2026-09-12 10:00:00'),
    (13, 2, 'Blouson cuir Maine',                'blouson-cuir-maine',
      'Blouson en cuir véritable au look vintage, coupe motard et bandes contrastées. Coques de protection CE amovibles aux épaules et aux coudes, poche pour dorsale, doublure thermique amovible.',
      379.90, 'blouson-cuir-maine.jpg',             '2026-09-13 10:00:00'),
    (14, 1, 'Smart Top Box 50 L',                'smart-top-box-50l',
      'Top box 50 L à ouverture sans clé, verrouillée avec la Smart Key du X-ADV. Livrée avec dosseret pour le confort du passager.',
      490.00, 'smart-top-box-50l.png',              '2026-09-14 10:00:00'),
    (15, 1, 'Kit top box aluminium 42 L',        'kit-top-box-aluminium-42l',
      'Top box en aluminium brossé 42 L avec platine de fixation.',
      399.00, NULL,                                 '2026-09-15 10:00:00'),
    (16, 2, 'Poignées chauffantes',              'poignees-chauffantes',
      'Poignées chauffantes d''origine, 5 niveaux de chauffe. X-ADV 750 (2017-2020).',
      311.90, 'poignees-chauffantes.jpg',           '2026-09-16 10:00:00'),
    (17, 2, 'Selle confort',                     'selle-confort',
      'Selle à mousse haute densité pour les longs trajets.',
      249.00, NULL,                                 '2026-09-17 10:00:00'),
    (18, 1, 'Sacoche de selle 10 L',             'sacoche-selle-10l',
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
