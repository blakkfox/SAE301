import { CartData } from "../../data/cart.js";
import { ProductData } from "../../data/product.js";
import { formatPrice } from "../../lib/format.js";
import { getStockStatus } from "../../lib/stock.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { CartLineView } from "../../ui/cart-line/index.js";
import { MessageView } from "../../ui/message/index.js";
import { PromoCodeFieldView } from "../../ui/promo-code-field/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateSummary from "./summary.html?raw";
import templateAlert from "./alert.html?raw";
import templateEmpty from "./empty.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Panier » — US CMD-b (écran Figma n° 4), route /panier.
 *
 * Le panier est gardé par le navigateur (data/cart.js) : des variantes et des
 * quantités. Les noms, photos et prix sont redemandés à l'API à chaque
 * affichage. Une variante que l'API ne renvoie plus (produit retiré du
 * catalogue) est retirée du panier, et l'utilisateur en est averti.
 *
 * Contraintes de stock (US STK-c, écran Figma n° 8) : le stock de chaque
 * variante est relu dans l'API. Une quantité supérieure au stock y est
 * ramenée au chargement, et la ligne le signale ; « + » s'arrête au stock.
 * Un article épuisé reste affiché, grisé : il est exclu du sous-total, une
 * alerte le signale et « Valider la commande » est désactivé tant qu'il
 * n'est pas retiré. Le serveur revérifie tout à la commande (CMD-a).
 *
 * Options (US OPT-a, écran Figma n° 17) : chaque ligne affiche ses options
 * cochées et leur supplément, compris dans le prix de la ligne ; le
 * récapitulatif sépare produits et options. « Modifier les options » ouvre,
 * dans la ligne, les cases à cocher de la fiche produit ; quand le produit
 * n'en propose qu'une, « + Ajouter une option » la coche directement. Les
 * suppléments sont relus dans l'API, et une option qui n'est plus proposée
 * est retirée du panier. Le serveur les revérifie à la commande (CMD-a).
 *
 * Code promo (US PRO-a, écran Figma n° 23) : le récapitulatif a un champ
 * « Code promo ». Le code saisi est vérifié par l'API (existe, actif), qui
 * donne sa réduction et son montant minimum ; la remise porte sur toute la
 * commande (produits, déjà remisés pour la promotion automatique, et
 * options). Le code est gardé pour la validation (data/cart.js) et revérifié
 * à chaque affichage ; tant que le montant minimum n'est pas atteint, il
 * reste saisi sans être appliqué. Le serveur revérifie tout à la commande.
 *
 * Comme les autres pages, C.init attend la réponse de l'API avant de rendre
 * la page. Changer une quantité ou une option ne reconstruit que la ligne et
 * le récapitulatif ; retirer une ligne reconstruit la zone du panier.
 *
 * Découpage MVC strict :
 *   M — état de la page, panier, appel à l'API, calcul des totaux ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Note sous « Valider la commande » quand rien ne bloque la validation.
const CHECKOUT_NOTE = "Paiement sur place au moment du retrait. Vos articles sont réservés 48 h.";

// Note ajoutée quand le panier contient des options (maquette, écran 17).
const OPTIONS_NOTE = "Les options sont reprises sur le bon de commande remis en concession.";

// Message affiché si le navigateur refuse d'enregistrer le panier.
const STORAGE_NOTICE = {
  type: "erreur",
  texte: "Votre panier n'a pas pu être enregistré sur cet appareil : il sera perdu en quittant la page.",
};

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  items: [], // lignes du panier : [{ variantId, quantity, optionIds }]
  variants: [], // variantes renvoyées par l'API (nom, photo, prix, stock, options…)
  adjusted: [], // variantes dont la quantité a été ramenée au stock au chargement
  editingVariantId: null, // ligne dont les options sont en cours de modification, ou null
  promoCode: null, // code promo vérifié par l'API : { code, discountRate, minAmount }, ou null
  promoInput: "", // texte du champ « Code promo »
  promoError: null, // message du dernier code refusé, ou null
  isPromoPending: false, // vérification d'un code en cours
  error: null, // texte de l'erreur de chargement, ou null
  notice: null, // { type, texte } à afficher au-dessus du panier, ou null
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.items = [];
  M.variants = [];
  M.adjusted = [];
  M.editingVariantId = null;
  M.promoCode = null;
  M.promoInput = "";
  M.promoError = null;
  M.isPromoPending = false;
  M.error = null;
  M.notice = null;
};

/**
 * Lit le panier, puis demande à l'API les variantes qu'il contient. Les
 * variantes que l'API ne renvoie pas ne sont plus au catalogue : elles sont
 * retirées du panier, comme les options qui ne sont plus proposées (OPT-a).
 * Les quantités sont ensuite ramenées au stock.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  M.error = null;
  M.items = CartData.read();

  if (M.items.length === 0) {
    M.variants = [];
    return;
  }

  try {
    let response = await CartData.fetchVariants(M.items.map((item) => item.variantId));
    M.variants = response.variants;
  } catch (error) {
    M.error = `Impossible de charger votre panier : ${error.message}`;
    return;
  }

  let missing = M.items.map((item) => item.variantId).filter((id) => M.findVariant(id) === undefined);

  if (missing.length > 0) {
    M.save(CartData.remove(missing));
    M.notice ??= {
      type: "erreur",
      texte:
        missing.length > 1
          ? `${missing.length} articles ne sont plus disponibles et ont été retirés de votre panier.`
          : "Un article n'est plus disponible et a été retiré de votre panier.",
    };
  }

  M.dropUnofferedOptions();
  M.adjustToStock();

  let storedCode = CartData.readPromoCode();
  if (storedCode !== null) {
    await M.applyPromoCode(storedCode);
  }
};

/**
 * Début de la vérification d'un code promo.
 *
 * @returns {boolean} false si une vérification est déjà en cours.
 */
M.startPromoCode = function () {
  if (M.isPromoPending) return false;

  M.isPromoPending = true;
  return true;
};

/**
 * Fait vérifier un code par l'API (PRO-a). Accepté, il est appliqué et
 * gardé pour la commande ; refusé (inconnu, programmé, expiré, épuisé), il
 * est oublié et le message de l'API s'affiche sous le champ. Si le serveur ne
 * répond pas, le code déjà appliqué, s'il y en a un, est gardé.
 *
 * @param {string} code - Code saisi.
 * @returns {Promise<void>}
 */
M.applyPromoCode = async function (code) {
  M.promoInput = code.trim().toUpperCase();

  try {
    if (M.promoInput === "") {
      M.promoError = "Saisissez un code promo.";
      return;
    }

    let response = await CartData.fetchPromoCode(M.promoInput);
    M.promoCode = response.promoCode;
    M.promoInput = response.promoCode.code;
    M.promoError = null;
    M.save(CartData.writePromoCode(response.promoCode.code));
  } catch (error) {
    if (error.statut === undefined) {
      M.promoError = "Le serveur ne répond pas : le code n'a pas pu être vérifié. Réessayez.";
    } else {
      M.promoCode = null;
      M.promoError = error.champs.promoCode ?? error.message;
      CartData.writePromoCode(null);
    }
  } finally {
    M.isPromoPending = false;
  }
};

/**
 * Retire le code promo appliqué.
 */
M.removePromoCode = function () {
  M.promoCode = null;
  M.promoInput = "";
  M.promoError = null;
  M.save(CartData.writePromoCode(null));
};

/**
 * Remise du code promo sur un montant (PRO-a), arrondie au centime le plus
 * proche, comme le serveur.
 *
 * @param {number} cents - Montant des produits et options, en centimes.
 * @returns {number} La remise en centimes : 0 sans code, ou si le montant
 *   minimum du code n'est pas atteint.
 */
M.getDiscountCents = function (cents) {
  if (M.promoCode === null || cents < M.toCents(M.promoCode.minAmount)) return 0;
  return Math.round((cents * M.promoCode.discountRate) / 100);
};

/**
 * Données du champ « Code promo » : le message de l'API pour un code refusé,
 * la remise accordée (maquette : « Code BIENVENUE10 appliqué : −10 % sur la
 * commande »), ou ce qu'il manque pour atteindre le montant minimum.
 *
 * @param {number} cents - Montant des produits et options, en centimes.
 * @returns {Parameters<typeof PromoCodeFieldView.dom>[0]}
 */
M.getPromoField = function (cents) {
  let message = null;

  if (M.promoError !== null) {
    message = { type: "error", text: M.promoError };
  } else if (M.promoCode !== null && M.getDiscountCents(cents) === 0) {
    let missing = formatPrice((M.toCents(M.promoCode.minAmount) - cents) / 100);
    message = {
      type: "info",
      text: `Le code ${M.promoCode.code} s'applique dès ${formatPrice(M.promoCode.minAmount)} d'achat : encore ${missing} pour en profiter.`,
    };
  } else if (M.promoCode !== null) {
    message = { type: "success", text: `Code ${M.promoCode.code} appliqué : −${M.promoCode.discountRate} % sur la commande` };
  }

  return {
    value: M.promoInput,
    isApplied: M.promoCode !== null,
    isPending: M.isPromoPending,
    message,
  };
};

/**
 * Retire du panier les options que l'API ne propose plus (OPT-a), et le
 * signale si aucun autre message ne l'est déjà.
 */
M.dropUnofferedOptions = function () {
  let result = CartData.keepOfferedOptions(M.variants);
  if (result.removed === 0) return;

  M.save(result.isSaved);
  M.notice ??= {
    type: "erreur",
    texte:
      result.removed > 1
        ? `${result.removed} options ne sont plus proposées et ont été retirées de votre panier.`
        : "Une option n'est plus proposée et a été retirée de votre panier.",
  };
};

/**
 * Ramène au stock disponible chaque quantité qui le dépasse (US STK-c), et
 * retient les lignes concernées pour le signaler. Un article épuisé garde sa
 * quantité : il doit être retiré pour valider.
 */
M.adjustToStock = function () {
  let over = M.items.filter((item) => {
    let variant = M.findVariant(item.variantId);
    return variant !== undefined && variant.stock > 0 && item.quantity > variant.stock;
  });

  if (over.length === 0) return;

  let isSaved = true;
  for (const item of over) {
    isSaved = CartData.setQuantity(item.variantId, M.findVariant(item.variantId).stock) && isSaved;
  }

  M.adjusted = over.map((item) => item.variantId);
  M.save(isSaved);
};

/**
 * Relit le panier après une écriture, et retient l'échec éventuel.
 *
 * @param {boolean} isSaved - Résultat de l'écriture (CartData).
 */
M.save = function (isSaved) {
  M.items = CartData.read();
  if (!isSaved) {
    M.notice = STORAGE_NOTICE;
  }
};

/**
 * @param {number} variantId
 * @returns {Object|undefined} La variante renvoyée par l'API, si elle existe.
 */
M.findVariant = function (variantId) {
  return M.variants.find((variant) => variant.variantId === variantId);
};

/**
 * @param {Object} variant - Variante renvoyée par l'API.
 * @returns {boolean} true si la variante est épuisée.
 */
M.isSoldOut = function (variant) {
  return variant.stock <= 0;
};

/**
 * Change la quantité d'une ligne, sans dépasser le stock. Une ligne épuisée
 * ne change pas. La note « Quantité ajustée » disparaît : le client a repris
 * la main.
 *
 * @param {number} variantId
 * @param {number} quantity - Nouvelle quantité (bornée aussi par CartData).
 */
M.setQuantity = function (variantId, quantity) {
  let variant = M.findVariant(variantId);
  if (variant === undefined || M.isSoldOut(variant)) return;

  M.adjusted = M.adjusted.filter((id) => id !== variantId);
  M.save(CartData.setQuantity(variantId, Math.min(quantity, variant.stock)));
};

/**
 * Retire une ligne du panier.
 *
 * @param {number} variantId
 */
M.remove = function (variantId) {
  M.adjusted = M.adjusted.filter((id) => id !== variantId);
  if (M.editingVariantId === variantId) {
    M.editingVariantId = null;
  }
  M.save(CartData.remove([variantId]));
};

/**
 * Ouvre la modification des options d'une ligne (OPT-a). Une seule ligne à
 * la fois : celle qui était ouverte se referme.
 *
 * @param {number} variantId
 * @returns {?number} La ligne qui était ouverte, à reconstruire, ou null.
 */
M.openOptions = function (variantId) {
  let previous = M.editingVariantId;
  let variant = M.findVariant(variantId);

  if (variant === undefined || M.isSoldOut(variant) || variant.options.length === 0) {
    return null;
  }

  M.editingVariantId = variantId;
  return previous === variantId ? null : previous;
};

/**
 * Referme la modification des options.
 */
M.closeOptions = function () {
  M.editingVariantId = null;
};

/**
 * Coche ou décoche une option d'une ligne (OPT-a), si son produit la
 * propose. Les options restent dans l'ordre d'affichage du produit.
 *
 * @param {number} variantId
 * @param {number} optionId
 * @param {boolean} isSelected - true pour cocher, false pour décocher.
 */
M.toggleOption = function (variantId, optionId, isSelected) {
  let item = M.items.find((candidate) => candidate.variantId === variantId);
  let variant = M.findVariant(variantId);

  if (item === undefined || variant === undefined || M.isSoldOut(variant)) return;
  if (!variant.options.some((option) => option.id === optionId)) return;

  let optionIds = variant.options
    .map((option) => option.id)
    .filter((id) => (id === optionId ? isSelected : item.optionIds.includes(id)));
  M.save(CartData.setOptions(variantId, optionIds));
};

/**
 * @param {{optionIds: number[]}} item - Ligne du panier.
 * @param {{options: Array<{id: number, label: string, description: ?string, price: number}>}} variant
 * @returns {Array<{id: number, label: string, description: ?string, price: number}>}
 *   Les options cochées de la ligne, dans l'ordre d'affichage du produit.
 */
M.getSelectedOptions = function (item, variant) {
  return variant.options.filter((option) => item.optionIds.includes(option.id));
};

/**
 * @param {{optionIds: number[]}} item - Ligne du panier.
 * @param {{options: Array<{id: number, price: number}>}} variant
 * @returns {number} Suppléments des options d'UN article, en centimes.
 */
M.getOptionsCents = function (item, variant) {
  return M.getSelectedOptions(item, variant).reduce((total, option) => total + M.toCents(option.price), 0);
};

/**
 * Nombre d'articles accordé.
 *
 * @param {number} count
 * @returns {string} Par exemple « 1 article » ou « 4 articles ».
 */
M.formatCount = function (count) {
  return `${count} ${count > 1 ? "articles" : "article"}`;
};

/**
 * @param {{name: string, label: string}} variant
 * @returns {string} « Casquette Factory · Coloris rouge », ou le nom seul
 *   pour une variante « Unique ».
 */
M.formatArticle = function (variant) {
  return variant.label === "Unique" ? variant.name : `${variant.name} · ${variant.label}`;
};

/**
 * @returns {Object[]} Les variantes épuisées du panier, dans l'ordre du panier.
 */
M.getSoldOutVariants = function () {
  return M.items
    .map((item) => M.findVariant(item.variantId))
    .filter((variant) => variant !== undefined && M.isSoldOut(variant));
};

/**
 * Texte de l'alerte de stock, comme sur la maquette.
 *
 * @returns {?string} null s'il n'y a aucun article épuisé.
 */
M.getAlert = function () {
  let count = M.getSoldOutVariants().length;

  if (count === 0) return null;
  if (count === 1) {
    return "Un article de votre panier n'est plus disponible. Retirez-le pour valider votre commande.";
  }
  return `${count} articles de votre panier ne sont plus disponibles. Retirez-les pour valider votre commande.`;
};

/**
 * Prix en centimes : additionner des centimes entiers évite les erreurs
 * d'arrondi des nombres à virgule (0,1 + 0,2 ≠ 0,3).
 *
 * @param {number} price - Prix en euros.
 * @returns {number}
 */
M.toCents = function (price) {
  return Math.round(price * 100);
};

/**
 * Données d'affichage d'une ligne.
 *
 * Sous le nom : la variante (ou la référence pour une variante « Unique »),
 * puis le prix unitaire dès que la quantité dépasse 1, comme sur la maquette
 * du panier, ou dès qu'une option est cochée, comme sur celle des options :
 * le prix de la ligne comprend leurs suppléments (OPT-a). Le produit en
 * promotion automatique (PRO-c) ajoute « promo −20 % », et son prix avant
 * remise est rappelé sous celui de la ligne (originalTotal, null sinon).
 * « + » s'arrête au stock (au moins 1, pour une ligne épuisée, désactivée).
 *
 * @param {number} variantId
 * @returns {?Parameters<typeof CartLineView.dom>[0]} null si la ligne n'existe plus.
 */
M.getLine = function (variantId) {
  let item = M.items.find((candidate) => candidate.variantId === variantId);
  let variant = M.findVariant(variantId);

  if (item === undefined || variant === undefined) {
    return null;
  }

  let optionsCents = M.getOptionsCents(item, variant);
  let details = [variant.label === "Unique" ? `Réf. ${variant.reference}` : variant.label];
  if (item.quantity > 1) {
    details.push(`${formatPrice(variant.price)} l'unité`);
  } else if (optionsCents > 0) {
    details.push(formatPrice(variant.price));
  }
  if (variant.discountRate !== null) {
    details.push(`promo −${variant.discountRate} %`);
  }

  return {
    variantId: variant.variantId,
    productId: variant.productId,
    productSlug: variant.slug,
    name: variant.name,
    label: variant.label,
    details: details.join(" · "),
    imageUrl: ProductData.imageUrl(variant.image),
    quantity: item.quantity,
    maxQuantity: Math.max(1, Math.min(variant.stock, CartData.MAX_QUANTITY)),
    total: formatPrice(((M.toCents(variant.price) + optionsCents) * item.quantity) / 100),
    originalTotal:
      variant.originalPrice === null
        ? null
        : formatPrice(((M.toCents(variant.originalPrice) + optionsCents) * item.quantity) / 100),
    stockStatus: getStockStatus(variant.stock, variant.lowStockThreshold),
    isSoldOut: M.isSoldOut(variant),
    stockNote: M.adjusted.includes(variantId)
      ? `Quantité ajustée à ${item.quantity} : stock maximum disponible`
      : null,
    options: M.getLineOptions(item, variant),
  };
};

/**
 * Données du bloc des options d'une ligne (OPT-a), ou null si le produit
 * n'en propose aucune.
 *
 * Sans option cochée, un produit qui n'en propose qu'une l'affiche dans le
 * lien, qui la coche directement (« + Ajouter une option (pose en atelier
 * + 60,00 €) ») ; sinon le lien ouvre les cases à cocher. Un article épuisé
 * n'a pas de lien.
 *
 * @param {{optionIds: number[]}} item - Ligne du panier.
 * @param {Object} variant - Variante renvoyée par l'API.
 * @returns {?{isEditing: boolean, selected: Array<{label: string, price: string}>,
 *   actionLabel: ?string, quickAddId: ?number, editor: ?Object}}
 */
M.getLineOptions = function (item, variant) {
  if (variant.options.length === 0) return null;

  let selected = M.getSelectedOptions(item, variant);
  let isEditing = M.editingVariantId === variant.variantId && !M.isSoldOut(variant);
  let only = variant.options.length === 1 && selected.length === 0 ? variant.options[0] : null;

  let actionLabel = selected.length > 0 ? "Modifier les options" : "+ Ajouter une option";
  if (only !== null) {
    let name = only.label.charAt(0).toLowerCase() + only.label.slice(1);
    actionLabel = `+ Ajouter une option (${name} + ${formatPrice(only.price)})`;
  }

  return {
    isEditing,
    selected: selected.map((option) => ({ label: option.label, price: `+ ${formatPrice(option.price)}` })),
    actionLabel: M.isSoldOut(variant) ? null : actionLabel,
    quickAddId: only === null || M.isSoldOut(variant) ? null : only.id,
    editor: isEditing
      ? {
          total: formatPrice((M.toCents(variant.price) + M.getOptionsCents(item, variant)) / 100),
          options: variant.options.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description ?? "",
            price: `+ ${formatPrice(option.price)}`,
            isSelected: item.optionIds.includes(option.id),
          })),
        }
      : null,
  };
};

/**
 * @returns {Array<NonNullable<ReturnType<typeof M.getLine>>>} Les lignes
 *   affichables, dans l'ordre du panier.
 */
M.getLines = function () {
  return M.items.map((item) => M.getLine(item.variantId)).filter((line) => line !== null);
};

/**
 * Totaux du récapitulatif. Sans frais : le total est la somme des produits et
 * des options, moins la remise du code promo (PRO-a), donnée par la ligne
 * « Remise BIENVENUE10 (−10 %) », retirée sans remise.
 *
 * Promotion automatique (PRO-c) : les produits sont comptés à leur prix
 * remisé ; la ligne « Dont promotion −20 % » donne, à titre d'information,
 * la remise déjà déduite. Elle est retirée sans produit en promotion.
 *
 * Les articles épuisés (STK-c) comptent à côté du titre, mais pas dans le
 * sous-total ; tant qu'il y en a, la validation est bloquée et la note dit
 * lesquels retirer.
 *
 * Options (OPT-a) : dès qu'une option est cochée, le sous-total s'intitule
 * « Produits » et une ligne « Options » donne la somme des suppléments,
 * comme sur la maquette (écran 17).
 *
 * @returns {{countLabel: string, subtotalTitle: string, subtotalLabel: string, subtotal: string,
 *   options: string, hasOptions: boolean, promoLabel: string, promo: string, hasPromo: boolean,
 *   promoField: ReturnType<typeof M.getPromoField>, discountLabel: string, discount: string,
 *   hasDiscount: boolean, total: string, canCheckout: boolean, note: string, optionsNote: string}}
 */
M.getSummary = function () {
  let count = 0;
  let availableCount = 0;
  let cents = 0;
  let optionsCents = 0;
  let promoCents = 0;
  let promoRate = null;

  for (const item of M.items) {
    let variant = M.findVariant(item.variantId);
    if (variant === undefined) continue;

    count += item.quantity;
    if (!M.isSoldOut(variant)) {
      availableCount += item.quantity;
      cents += M.toCents(variant.price) * item.quantity;
      optionsCents += M.getOptionsCents(item, variant) * item.quantity;
      if (variant.originalPrice !== null) {
        promoCents += (M.toCents(variant.originalPrice) - M.toCents(variant.price)) * item.quantity;
        promoRate = variant.discountRate;
      }
    }
  }

  let soldOut = M.getSoldOutVariants();
  let subtotalLabel = M.formatCount(availableCount);
  let note = CHECKOUT_NOTE;
  let discountCents = M.getDiscountCents(cents + optionsCents);

  if (soldOut.length > 0) {
    subtotalLabel += availableCount > 1 ? " disponibles" : " disponible";
    note =
      soldOut.length > 1
        ? `Retirez les ${soldOut.length} articles épuisés pour pouvoir valider.`
        : `Retirez l'article épuisé (${M.formatArticle(soldOut[0])}) pour pouvoir valider.`;
  }

  return {
    countLabel: M.formatCount(count),
    subtotalTitle: optionsCents > 0 ? "Produits" : "Sous-total",
    subtotalLabel,
    subtotal: formatPrice(cents / 100),
    options: formatPrice(optionsCents / 100),
    hasOptions: optionsCents > 0,
    promoLabel: promoRate === null ? "Dont promotion" : `Dont promotion −${promoRate} %`,
    promo: `−${formatPrice(promoCents / 100)}`,
    hasPromo: promoCents > 0,
    promoField: M.getPromoField(cents + optionsCents),
    discountLabel: M.promoCode === null ? "" : `Remise ${M.promoCode.code} (−${M.promoCode.discountRate} %)`,
    discount: `−${formatPrice(discountCents / 100)}`,
    hasDiscount: discountCents > 0,
    total: formatPrice((cents + optionsCents - discountCents) / 100),
    canCheckout: soldOut.length === 0,
    note,
    optionsNote: OPTIONS_NOTE,
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "error"|"empty"|"filled", error: ?string,
 *   notice: ?{type: string, texte: string}, alert: ?string,
 *   lines: ReturnType<typeof M.getLines>, summary: ReturnType<typeof M.getSummary>}}
 */
M.getViewData = function () {
  let lines = M.error === null ? M.getLines() : [];
  let state = "filled";

  if (M.error !== null) {
    state = "error";
  } else if (lines.length === 0) {
    state = "empty";
  }

  return {
    state,
    error: M.error,
    notice: M.notice,
    alert: state === "filled" ? M.getAlert() : null,
    lines,
    summary: M.getSummary(),
  };
};

// ---------------------------------------------------------------------------
// C — Contrôleur
// ---------------------------------------------------------------------------

let C = {};

/**
 * Point d'entrée de la page, appelé par le routeur.
 *
 * @returns {Promise<DocumentFragment>}
 */
C.init = async function () {
  M.reset();
  await M.load();
  return V.init(M.getViewData());
};

/**
 * Clic sur « − » ou « + » d'une ligne.
 *
 * @param {number} variantId
 * @param {number} quantity - Quantité demandée.
 */
C.handler_changeQuantity = function (variantId, quantity) {
  M.setQuantity(variantId, quantity);
  V.renderLine(M.getLine(variantId));
  V.renderSummary(M.getSummary());
  V.renderNotice(M.notice);
};

/**
 * Clic sur « Modifier les options » ou « + Ajouter une option » (OPT-a) :
 * la ligne affiche ses cases à cocher. Une autre ligne ouverte se referme.
 *
 * @param {number} variantId
 */
C.handler_editOptions = function (variantId) {
  let previous = M.openOptions(variantId);
  if (previous !== null) {
    V.renderLine(M.getLine(previous));
  }
  V.renderLine(M.getLine(variantId));
};

/**
 * Case d'option cochée ou décochée dans une ligne, ou option ajoutée
 * directement par son lien (OPT-a) : la ligne et le récapitulatif suivent.
 *
 * @param {number} variantId
 * @param {number} optionId
 * @param {boolean} isSelected - Nouvel état de l'option.
 */
C.handler_toggleOption = function (variantId, optionId, isSelected) {
  M.toggleOption(variantId, optionId, isSelected);
  V.renderLine(M.getLine(variantId));
  V.renderSummary(M.getSummary());
  V.renderNotice(M.notice);
};

/**
 * Clic sur « Terminer » : la ligne affiche de nouveau ses options cochées.
 *
 * @param {number} variantId
 */
C.handler_closeOptions = function (variantId) {
  M.closeOptions();
  V.renderLine(M.getLine(variantId));
};

/**
 * Clic sur « Appliquer » (ou Entrée dans le champ « Code promo ») : le
 * bouton passe à « Vérification… », puis le récapitulatif affiche la remise
 * ou le refus.
 *
 * @param {string} code - Code saisi.
 * @returns {Promise<void>}
 */
C.handler_applyPromoCode = async function (code) {
  if (!M.startPromoCode()) return;
  V.renderSummary(M.getSummary());

  await M.applyPromoCode(code);
  V.renderSummary(M.getSummary());
  V.renderNotice(M.notice);
};

/**
 * Clic sur « Retirer le code ».
 */
C.handler_removePromoCode = function () {
  M.removePromoCode();
  V.renderSummary(M.getSummary());
  V.renderNotice(M.notice);
};

/**
 * Clic sur « Retirer » : la zone du panier et l'alerte de stock sont
 * reconstruites.
 *
 * @param {number} variantId
 */
C.handler_remove = function (variantId) {
  M.remove(variantId);
  V.renderContent(M.getViewData());
  V.focusContent();
};

/**
 * Clic sur « Réessayer » après une erreur de chargement.
 *
 * @returns {Promise<void>}
 */
C.handler_retry = async function () {
  await M.load();
  V.renderContent(M.getViewData());
};

/**
 * Le panier a changé dans un autre onglet (événement « storage ») : la page
 * relit le panier et se reconstruit, comme le compteur de l'en-tête.
 *
 * @returns {Promise<void>}
 */
C.handler_storageChange = async function () {
  await M.load();
  V.renderContent(M.getViewData());
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  content: null, // zone du panier affichée (colonnes, panier vide ou erreur)
  summary: null, // récapitulatif affiché, ou null
  countLabel: null, // « 4 articles » à côté du titre
  alert: null, // conteneur de l'alerte de stock
  notice: null, // conteneur des messages
  hasStorageListener: false, // l'écouteur « storage » est posé
};

/**
 * Écouteur « storage », posé une seule fois : la page est reconstruite à
 * chaque visite, il s'accumulerait. Il n'agit que si la page Panier est
 * affichée.
 */
V.listenStorage = function () {
  if (V.hasStorageListener) return;

  window.addEventListener("storage", () => {
    if (V.content?.isConnected) C.handler_storageChange();
  });
  V.hasStorageListener = true;
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  V.listenStorage();
  let page = htmlToFragment(genericRenderer(template, { countLabel: data.summary.countLabel }));

  V.countLabel = page.querySelector("[data-cart-count-label]");
  V.alert = page.querySelector("[data-cart-alert]");
  V.notice = page.querySelector("[data-cart-notice]");
  V.renderAlert(data.alert);
  V.renderNotice(data.notice);

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit la zone du panier, le compteur, l'alerte et les messages.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.renderContent = function (data) {
  let content = V.createContentFragment(data);
  let newContent = content.firstElementChild;
  V.content.replaceWith(content);
  V.content = newContent;

  V.countLabel.textContent = data.summary.countLabel;
  V.renderAlert(data.alert);
  V.renderNotice(data.notice);
};

/**
 * Reconstruit une ligne, en gardant le focus sur le bouton utilisé.
 *
 * @param {?Parameters<typeof CartLineView.dom>[0]} line
 */
V.renderLine = function (line) {
  if (line === null) return;

  let element = V.content.querySelector(`[data-variant-id="${line.variantId}"]`);
  replaceKeepingFocus(element, V.createLineFragment(line));
};

/**
 * Reconstruit le récapitulatif et le compteur à côté du titre, en gardant le
 * focus dans le champ « Code promo » ou sur son bouton.
 *
 * @param {ReturnType<typeof M.getSummary>} summary
 */
V.renderSummary = function (summary) {
  V.countLabel.textContent = summary.countLabel;

  if (V.summary === null) return;
  V.summary = replaceKeepingFocus(V.summary, V.createSummaryFragment(summary));
};

/**
 * Affiche l'alerte de stock reçue, ou aucune.
 *
 * @param {?string} text
 */
V.renderAlert = function (text) {
  if (text === null) {
    V.alert.replaceChildren();
  } else {
    V.alert.replaceChildren(htmlToFragment(genericRenderer(templateAlert, { text })));
  }
};

/**
 * Affiche le message reçu, ou aucun.
 *
 * @param {?{type: string, texte: string}} notice
 */
V.renderNotice = function (notice) {
  V.notice.replaceChildren(MessageView.dom(notice));
};

/**
 * Donne le focus à la zone du panier (après le retrait d'une ligne, le
 * bouton « Retirer » utilisé n'existe plus).
 */
V.focusContent = function () {
  V.content.focus();
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} Les colonnes du panier, le panier vide ou l'erreur.
 */
V.createContentFragment = function (data) {
  V.summary = null;

  if (data.state === "error") {
    let fragment = htmlToFragment(genericRenderer(templateError, { text: data.error }));
    fragment.querySelector("[data-retry]").addEventListener("click", C.handler_retry);
    return fragment;
  }

  if (data.state === "empty") {
    return htmlToFragment(templateEmpty);
  }

  let fragment = htmlToFragment(templateContent);
  fragment.querySelector('slot[name="lines"]').replaceWith(...data.lines.map(V.createLineFragment));

  let summary = V.createSummaryFragment(data.summary);
  V.summary = summary.firstElementChild;
  fragment.querySelector('slot[name="summary"]').replaceWith(summary);

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getSummary>} summary
 * @returns {DocumentFragment} Le récapitulatif, avec le lien « Valider la
 *   commande », ou le bouton désactivé si un article épuisé bloque la
 *   validation. La ligne « Options » et sa note n'y sont que si une option
 *   est cochée (OPT-a), la ligne de remise que si un code promo est
 *   appliqué (PRO-a).
 */
V.createSummaryFragment = function (summary) {
  let fragment = htmlToFragment(genericRenderer(templateSummary, summary));
  let unused = summary.canCheckout ? "[data-checkout-blocked]" : "[data-checkout-link]";
  fragment.querySelector(unused).remove();

  fragment.querySelector('slot[name="promo-code"]').replaceWith(
    PromoCodeFieldView.dom(summary.promoField, {
      onApply: C.handler_applyPromoCode,
      onRemove: C.handler_removePromoCode,
    })
  );

  if (!summary.hasPromo) {
    fragment.querySelector("[data-summary-promo]").remove();
  }
  if (!summary.hasDiscount) {
    fragment.querySelector("[data-summary-discount]").remove();
  }
  if (!summary.hasOptions) {
    fragment.querySelector("[data-summary-options]").remove();
    fragment.querySelector("[data-summary-options-note]").remove();
  }
  return fragment;
};

/**
 * @param {Parameters<typeof CartLineView.dom>[0]} line
 * @returns {DocumentFragment} La ligne, reliée au contrôleur.
 */
V.createLineFragment = function (line) {
  return CartLineView.dom(line, {
    onQuantity: C.handler_changeQuantity,
    onRemove: C.handler_remove,
    onEditOptions: C.handler_editOptions,
    onToggleOption: C.handler_toggleOption,
    onCloseOptions: C.handler_closeOptions,
  });
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function CartPage() {
  return C.init();
}
