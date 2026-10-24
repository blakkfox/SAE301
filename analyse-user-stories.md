# Analyse des user stories

## 1. Méthode

Pour chaque user story (US), je me suis demandé : **« qu'est-ce qui doit déjà exister pour que je puisse la faire et la tester ? »**

J'ai distingué deux types de liens :
- **Dépendance forte** (flèche pleine) : sans l'autre US, celle-ci est impossible. Exemple : pas de validation de commande (CMD-a) sans panier (CMD-b).
- **Dépendance faible** (flèche en pointillés) : on pourrait commencer, mais on risquerait de devoir reprendre du code. Exemple : la gestion des produits (GOF-a) peut exister sans les variantes, mais il faudrait réécrire son formulaire ensuite.

J'ai aussi estimé la **complexité** de chaque US, puisque leur poids n'est pas communiqué : **S** = simple, **M** = moyenne, **L** = lourde.

## 2. Graphe des dépendances

Une flèche `A → B` signifie que **B a besoin de A**. Le numéro devant chaque US est son ordre de réalisation, et la lettre en dessous sa complexité. Les flèches en pointillés sont les dépendances faibles.

https://www.figma.com/board/5PTZmJMqai9nXtXoEgggTL/Untitled?node-id=0-1&t=vKkRq16TUV1LP71v-1

### Ce que montre le graphe

- **DEC-b (Catalogue) est la racine** : sans produits en base, aucune autre US ne fonctionne. Elle passe donc en premier.
- **CMD-a (Validation de commande) est le point central** : stocks, gestion des commandes, historique, options et codes promo en dépendent. La faire tôt débloque la moitié du projet.
- **CMD-c (Authentification) n'a aucun prérequis** : elle pourrait être faite à tout moment. Je la place juste avant CMD-a, qui en a besoin.
- **GOF-b (Back-office) est la porte d'entrée de toute la partie admin.**
- **OPT-b (Variantes) arrive en bout de chaîne** et dépend de trois US de stock : c'est la plus risquée, car elle modifie du code déjà écrit.
- **Un cas particulier entre STK-a et PIL-b** : STK-a doit remettre en stock les produits d'une commande annulée, mais c'est PIL-b qui permet d'annuler. Dans STK-a, j'écris la fonction de remise en stock et je la teste directement ; PIL-b n'aura qu'à l'appeler.

## 3. Dépendances de chaque US

| US | Titre | Complexité | A besoin de |
|---|---|---|---|
| DEC-b | Catalogue | M | rien |
| DEC-c | Détail produit | M | DEC-b |
| DEC-a | Catégories | S | DEC-b |
| CMD-b | Panier | M | DEC-c |
| CMD-c | Authentification | M | rien |
| CMD-a | Validation commande | L | CMD-b, CMD-c |
| STK-b | Affichage stocks | S | DEC-c |
| STK-c | Contraintes stock | M | STK-b, CMD-a |
| STK-a | MAJ auto des stocks | L | STK-b, CMD-a |
| GOF-b | Back-office | M | DEC-b |
| PIL-b | Gestion commandes | L | GOF-b, STK-a |
| GOF-c | Gestion catégories | S | GOF-b, DEC-a |
| SUI-c | Historique | M | CMD-a *(faible : PIL-b, pour que les statuts évoluent)* |
| SUI-b | Espace perso | S | SUI-c |
| SUI-a | Commander à nouveau | M | SUI-c, STK-c *(faible : OPT-a)* |
| OPT-c | Choix options | M | DEC-c |
| OPT-a | Options panier/commande | M | OPT-c, CMD-a |
| OPT-b | Variantes | L | OPT-c, STK-a, STK-c |
| GOF-a | Gestion produits | L | GOF-b, STK-b *(faible : OPT-b)* |
| PIL-a | Statistiques | M | PIL-b |
| PRO-c | Promos auto | S | STK-b |
| PRO-b | Gestion codes | S | GOF-b |
| PRO-a | Codes promo | S | PRO-b, CMD-a |

## 4. Ordre de réalisation

Le travail est découpé en **lots**. Chaque lot se termine par un site qui fonctionne : si je manque de temps, je m'arrête à la fin d'un lot avec un travail propre.

| Lot | US | Pourquoi |
|---|---|---|
| **0. Préparation** | Maquettes, base de données | Je conçois dès le départ une base **avec variantes** : chaque produit a au moins une variante, et c'est elle qui porte le stock. Quand OPT-b arrivera, il n'y aura pas à réécrire le panier, les commandes et les stocks. |
| **1. Vitrine** | DEC-b → DEC-c → DEC-a | Le catalogue est la racine. Le détail produit vient ensuite car le panier et les options en ont besoin. |
| **2. Commande** | CMD-b → CMD-c → CMD-a | Après 6 US, le site fonctionne de bout en bout (catalogue, panier, connexion, commande) : c'est le cœur du click & collect. |
| **3. Stocks** | STK-b → STK-c → STK-a | De la plus simple à la plus technique. STK-b ajoute les champs de stock, STK-c bloque les commandes impossibles, STK-a gère les transactions. |
| **4. Admin de base** | GOF-b → PIL-b → GOF-c | PIL-b permet au magasin de traiter et d'annuler les commandes, ce qui termine la remise en stock de STK-a. GOF-c est un CRUD simple. |
| **5. Espace client** | SUI-c → SUI-b → SUI-a | Les commandes et leurs statuts existent maintenant. SUI-c fournit la liste des commandes réutilisée par les deux autres. |
| **6. Options** | OPT-c → OPT-a → OPT-b | La partie la plus risquée, faite quand le reste est stable. Grâce au lot 0, OPT-b ne demande pas de tout réécrire. |
| **7. Admin avancée** | GOF-a → PIL-a | GOF-a attend les variantes pour n'écrire le formulaire produit qu'une fois (en attendant, les produits sont insérés en base). PIL-a exploite toutes les données. |
| **8. Bonus** | PRO-c → PRO-b → PRO-a | Promotions, seulement si tout le reste est terminé et propre. |

## 5. Justification

- **Dépendances techniques** : aucune US n'est faite avant une US dont elle a besoin.
- **Valeur pour l'utilisateur** : le parcours client (lots 1 et 2) passe avant tout le reste.
- **Complexité et risque** : CMD-a, lourde mais centrale, est faite tôt. OPT-b et STK-a, lourdes mais en bout de chaîne, sont faites quand le code qu'elles touchent est stable.
- **Risque de reprendre du code** : la base avec variantes est anticipée dès le lot 0, et GOF-a attend les variantes.
- **Livrable à tout moment** : chaque lot laisse un site cohérent, ce qui suit le conseil du sujet (« en faire un peu moins mais très bien »).

## 6. Autres ordres possibles

- **L'admin juste après le catalogue**, pour gérer les produits depuis l'interface. Je ne l'ai pas retenu car cela retarde le parcours client et oblige à reprendre GOF-a quand les variantes arrivent.
- **L'espace client avant l'admin.** Possible, mais les statuts des commandes resteraient bloqués sur « en cours » tant que PIL-b n'existe pas.
