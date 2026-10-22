import { CartData } from "../../data/cart.js";
import { OrderData } from "../../data/order.js";
import { formatPrice } from "../../lib/format.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { CheckoutStepsView } from "../../ui/checkout-steps/index.js";
import { MessageView } from "../../ui/message/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templateDetails from "./details.html?raw";
import templateDealership from "./dealership.html?raw";
import templateSlot from "./slot.html?raw";
import templateNoSlot from "./no-slot.html?raw";
import templateSummary from "./summary.html?raw";
import templateSummaryLine from "./summary-line.html?raw";
import templateConfirmed from "./confirmed.html?raw";
import templateUnavailable from "./unavailable.html?raw";
import templateLogin from "./login.html?raw";
import templateEmpty from "./empty.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Validation de commande » — US CMD-a (écran Figma n° 6), route /commande.
 *
 * Étape « Retrait » du parcours Panier → Connexion → Retrait → Confirmation :
 * le client choisit sa concession et son créneau, relit ses coordonnées et
 * son récapitulatif, puis confirme. Le paiement se fait sur place.
 *
 * Les créneaux viennent du serveur, qui les recalcule à l'envoi ; il y
 * revérifie aussi les quantités, le stock et les prix, dans une transaction.
 * Si un article a été pris entre-temps, rien n'est enregistré et la page le
 * dit (écran 9, STK-a). Une fois la commande enregistrée, le stock est baissé
 * (STK-a), le panier est vidé et la page passe à l'étape 4.
 *
 * Options (US OPT-a) : le récapitulatif liste les options de chaque article,
 * dont le prix comprend les suppléments, et la commande envoie leurs
 * identifiants. Le serveur relit les suppléments en base et refuse (422) une
 * option qui n'est plus proposée.
 *
 * Découpage MVC strict :
 *   M — panier, données de validation, choix, envoi, textes et montants ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Libellés des étapes, dans l'ordre (composant CheckoutSteps).
const STEP_LABELS = ["Panier", "Connexion", "Retrait", "Confirmation"];

// Étape en cours selon l'état de la page.
const CURRENT_STEP = { empty: 1, login: 2, error: 3, form: 3, unavailable: 3, confirmed: 4 };

// Titre de la page selon son état.
const TITLES = {
  empty: "Retrait de la commande",
  login: "Retrait de la commande",
  error: "Retrait de la commande",
  form: "Retrait de la commande",
  unavailable: "Commande non passée",
  confirmed: "Commande confirmée",
};

// Libellé du statut d'une commande (colonne customer_order.status).
const STATUS_LABELS = { en_cours: "en cours", disponible: "disponible", retiree: "retirée", annulee: "annulée" };

// Jour d'un créneau au-delà de demain (« lun. 26 ») et date du créneau
// confirmé (« mardi 21 octobre »). Les dates sont lues en UTC : ce sont des
// dates de Lyon déjà calculées par le serveur, sans heure à convertir.
const SHORT_DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });
const LONG_DAY = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  items: [], // lignes du panier : [{ variantId, quantity, optionIds }]
  variants: [], // variantes du panier renvoyées par l'API (nom, prix, options…)
  checkout: null, // { customer, dealerships, slots } renvoyé par l'API, ou null
  dealershipId: null, // concession choisie
  slotId: null, // créneau choisi (« 2026-10-21T16:00 »), ou null
  isLoggedOut: false, // l'API a répondu 401 : personne n'est connecté
  isSubmitting: false, // envoi de la commande en cours
  error: null, // texte de l'erreur de chargement, ou null
  notice: null, // { type, texte } à afficher au-dessus de la page, ou null
  unavailable: null, // texte de l'alerte « stock pris entre-temps » (409), ou null
  order: null, // commande enregistrée, ou null
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.items = [];
  M.variants = [];
  M.checkout = null;
  M.dealershipId = null;
  M.slotId = null;
  M.isLoggedOut = false;
  M.isSubmitting = false;
  M.error = null;
  M.notice = null;
  M.unavailable = null;
  M.order = null;
};

/**
 * Lit le panier, puis demande à l'API, en parallèle, les données de
 * validation et les variantes du panier. Les variantes que l'API ne renvoie
 * plus sont retirées du panier, comme sur la page Panier, ainsi que les
 * options qui ne sont plus proposées (OPT-a). Un stock devenu insuffisant
 * (STK-c) est signalé : le serveur refuserait la commande.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  M.error = null;
  M.isLoggedOut = false;
  M.items = CartData.read();

  if (M.items.length === 0) return;

  try {
    let [checkout, cart] = await Promise.all([
      OrderData.fetchCheckout(),
      CartData.fetchVariants(M.items.map((item) => item.variantId)),
    ]);
    M.setCheckout(checkout);
    M.variants = cart.variants;
  } catch (error) {
    M.storeLoadError(error);
    return;
  }

  let missing = M.items.map((item) => item.variantId).filter((id) => M.findVariant(id) === undefined);

  if (missing.length > 0) {
    CartData.remove(missing);
    M.items = CartData.read();
    M.notice = {
      type: "erreur",
      texte:
        missing.length > 1
          ? `${missing.length} articles ne sont plus disponibles et ont été retirés de votre panier.`
          : "Un article n'est plus disponible et a été retiré de votre panier.",
    };
  }

  let options = CartData.keepOfferedOptions(M.variants);
  if (options.removed > 0) {
    M.items = CartData.read();
    M.notice ??= {
      type: "erreur",
      texte:
        options.removed > 1
          ? `${options.removed} options ne sont plus proposées et ont été retirées de votre panier.`
          : "Une option n'est plus proposée et a été retirée de votre panier.",
    };
  }

  let short = M.items.filter((item) => {
    let variant = M.findVariant(item.variantId);
    return variant !== undefined && item.quantity > variant.stock;
  });

  if (short.length > 0) {
    M.notice ??= { type: "erreur", texte: M.formatShortage(short.map((item) => item.variantId)) };
  }
};

/**
 * Message d'un stock insuffisant constaté au chargement, avant tout envoi.
 *
 * @param {number[]} variantIds - Variantes dont le stock ne suffit plus.
 * @returns {string}
 */
M.formatShortage = function (variantIds) {
  let names = variantIds.map((id) => M.formatArticle(M.findVariant(id)));
  return `Stock insuffisant : ${names.join(", ")}. Modifiez votre panier avant de valider.`;
};

/**
 * Range une erreur de chargement : 401 (non connecté) ou panne.
 *
 * @param {Error} error - ErreurApi, ou TypeError si le serveur est injoignable.
 */
M.storeLoadError = function (error) {
  if (error.statut === 401) {
    M.isLoggedOut = true;
  } else if (error.statut === undefined) {
    M.error = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";
  } else {
    M.error = `Impossible de préparer votre commande : ${error.message}`;
  }
};

/**
 * Retient les données de validation, et garde les choix encore possibles :
 * sinon, la concession préférée du compte (SUI-b) ou la première, et le
 * premier créneau.
 *
 * @param {Awaited<ReturnType<typeof OrderData.fetchCheckout>>} checkout
 */
M.setCheckout = function (checkout) {
  M.checkout = checkout;

  if (!checkout.dealerships.some((dealership) => dealership.id === M.dealershipId)) {
    let preferred = checkout.dealerships.find((dealership) => dealership.id === checkout.customer.preferredDealershipId);
    M.dealershipId = (preferred ?? checkout.dealerships[0])?.id ?? null;
  }
  if (!checkout.slots.some((slot) => slot.id === M.slotId)) {
    M.slotId = checkout.slots[0]?.id ?? null;
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
 * @param {number} dealershipId - Concession choisie (une de M.checkout).
 */
M.setDealership = function (dealershipId) {
  if (M.checkout.dealerships.some((dealership) => dealership.id === dealershipId)) {
    M.dealershipId = dealershipId;
  }
};

/**
 * @param {string} slotId - Créneau choisi (un de M.checkout).
 */
M.setSlot = function (slotId) {
  if (M.checkout.slots.some((slot) => slot.id === slotId)) {
    M.slotId = slotId;
  }
};

/**
 * Début de l'envoi.
 *
 * @returns {boolean} false si un envoi est déjà en cours ou si un choix manque.
 */
M.startSubmit = function () {
  if (M.isSubmitting || M.dealershipId === null || M.slotId === null) return false;

  M.isSubmitting = true;
  M.notice = null;
  return true;
};

/**
 * Envoie la commande. En cas de succès, le panier est vidé.
 *
 * @returns {Promise<void>}
 */
M.submit = async function () {
  try {
    let response = await OrderData.create({
      dealershipId: M.dealershipId,
      slot: M.slotId,
      items: M.items.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
        optionIds: item.optionIds,
      })),
    });
    M.order = response.order;
    M.notice = CartData.clear()
      ? null
      : { type: "erreur", texte: "Commande enregistrée, mais votre panier n'a pas pu être vidé sur cet appareil." };
  } catch (error) {
    await M.storeSubmitError(error);
  } finally {
    M.isSubmitting = false;
  }
};

/**
 * Range l'erreur d'un envoi refusé. Un créneau refusé (422) a sans doute
 * expiré : les créneaux sont alors redemandés.
 *
 * @param {Error} error - ErreurApi, ou TypeError si le serveur est injoignable.
 * @returns {Promise<void>}
 */
M.storeSubmitError = async function (error) {
  if (error.statut === 401) {
    M.isLoggedOut = true;
  } else if (error.statut === 409) {
    M.unavailable = M.formatUnavailable(error.donnees?.indisponibles ?? []);
  } else if (error.statut === 422) {
    M.notice = { type: "erreur", texte: Object.values(error.champs).join(" ") || error.message };
    try {
      M.setCheckout(await OrderData.fetchCheckout());
    } catch (reloadError) {
      M.storeLoadError(reloadError);
    }
  } else if (error.statut === undefined) {
    M.notice = { type: "erreur", texte: "Le serveur ne répond pas : votre commande n'a pas été envoyée. Réessayez." };
  } else {
    M.notice = { type: "erreur", texte: `Votre commande n'a pas pu être enregistrée : ${error.message}` };
  }
};

/**
 * Message d'un stock pris entre-temps (409, écran 9), avec le nom des
 * articles en cause. « Le stock de… » évite d'accorder un participe au
 * genre du produit, que l'API ne donne pas.
 *
 * @param {number[]} variantIds - Variantes indisponibles, selon l'API.
 * @returns {string}
 */
M.formatUnavailable = function (variantIds) {
  let names = variantIds
    .map((id) => M.findVariant(id))
    .filter((variant) => variant !== undefined)
    .map((variant) => `« ${M.formatArticle(variant)} »`);

  let cause = "Désolé, un article vient d'être acheté par un autre client.";
  if (names.length === 1) {
    cause = `Désolé, le stock de ${names[0]} vient d'être pris par un autre client.`;
  } else if (names.length > 1) {
    cause = `Désolé, le stock de ${names.slice(0, -1).join(", ")} et ${names.at(-1)} vient d'être pris par d'autres clients.`;
  }
  return `${cause} Votre commande n'a pas été passée et rien n'a été débité.`;
};

/**
 * @param {{name: string, label: string}} variant
 * @returns {string} « Blouson cuir Maine · Taille M », ou le nom seul pour
 *   une variante « Unique ».
 */
M.formatArticle = function (variant) {
  return variant.label === "Unique" ? variant.name : `${variant.name} · ${variant.label}`;
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
 * Nombre d'articles accordé.
 *
 * @param {number} count
 * @returns {string} Par exemple « 1 article » ou « 4 articles ».
 */
M.formatCount = function (count) {
  return `${count} ${count > 1 ? "articles" : "article"}`;
};

/**
 * @param {string} phone - Numéro enregistré, par exemple « 0601020304 ».
 * @returns {string} « 06 01 02 03 04 », ou le numéro tel quel s'il n'a pas
 *   10 chiffres (« +33… »).
 */
M.formatPhone = function (phone) {
  return /^\d{10}$/.test(phone) ? phone.replace(/(\d{2})(?=\d)/g, "$1 ") : phone;
};

/**
 * @param {string} date - Date « 2026-10-26 ».
 * @param {Intl.DateTimeFormat} format - SHORT_DAY ou LONG_DAY.
 * @returns {string} La date mise en forme, avec une majuscule initiale.
 */
M.formatDate = function (date, format) {
  let text = format.format(new Date(`${date}T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * @param {{date: string, dayOffset: number, startHour: number, endHour: number}} slot
 * @returns {string} « Auj. 16 h – 18 h », « Demain 10 h – 12 h » ou « Lun. 26 10 h – 12 h ».
 */
M.formatSlot = function (slot) {
  let day = "Auj.";
  if (slot.dayOffset === 1) {
    day = "Demain";
  } else if (slot.dayOffset > 1) {
    day = M.formatDate(slot.date, SHORT_DAY);
  }
  return `${day} ${slot.startHour} h – ${slot.endHour} h`;
};

/**
 * Phrase sous les créneaux.
 *
 * @returns {string} Par exemple « Votre commande sera prête dès 16 h. »
 */
M.getSlotNote = function () {
  let slot = M.checkout.slots.find((candidate) => candidate.id === M.slotId);

  if (slot === undefined) {
    return "Les créneaux commencent au plus tôt 2 h après la commande, du lundi au samedi.";
  }

  let day = "";
  if (slot.dayOffset === 1) {
    day = "demain ";
  } else if (slot.dayOffset > 1) {
    day = `le ${M.formatDate(slot.date, LONG_DAY).toLowerCase()} `;
  }
  return `Votre commande sera prête ${day}dès ${slot.startHour} h.`;
};

/**
 * @param {string} start - Début du créneau, « 2026-10-21 16:00:00 ».
 * @param {string} end - Fin du créneau, « 2026-10-21 18:00:00 ».
 * @returns {string} « Mardi 21 octobre, 16 h – 18 h ».
 */
M.formatPickup = function (start, end) {
  let hour = (datetime) => Number(datetime.slice(11, 13));
  return `${M.formatDate(start.slice(0, 10), LONG_DAY)}, ${hour(start)} h – ${hour(end)} h`;
};

/**
 * @returns {Array<{number: number, label: string, state: "done"|"current"|"todo"}>}
 *   Les étapes du parcours, selon l'état de la page.
 */
M.getSteps = function () {
  let current = CURRENT_STEP[M.getState()];

  return STEP_LABELS.map((label, index) => {
    let number = index + 1;
    let state = "todo";
    if (number < current || (number === current && number === STEP_LABELS.length)) {
      state = "done";
    } else if (number === current) {
      state = "current";
    }
    return { number, label, state };
  });
};

/**
 * @returns {"empty"|"login"|"error"|"form"|"unavailable"|"confirmed"} L'état de la page.
 */
M.getState = function () {
  if (M.order !== null) return "confirmed";
  if (M.unavailable !== null) return "unavailable";
  if (M.isLoggedOut) return "login";
  if (M.error !== null) return "error";
  if (M.items.length === 0 || M.checkout === null) return "empty";
  return "form";
};

/**
 * Données du choix de concession et de créneau.
 *
 * @returns {{dealerships: Array<{id: number, name: string, address: string, hoursLabel: string,
 *   isSelected: boolean}>, slots: Array<{id: string, label: string, isSelected: boolean}>,
 *   slotNote: string}}
 */
M.getDetailsData = function () {
  return {
    dealerships: M.checkout.dealerships.map((dealership) => ({
      id: dealership.id,
      name: dealership.name,
      address: dealership.address,
      hoursLabel: dealership.hoursLabel,
      isSelected: dealership.id === M.dealershipId,
    })),
    slots: M.checkout.slots.map((slot) => ({
      id: slot.id,
      label: M.formatSlot(slot),
      isSelected: slot.id === M.slotId,
    })),
    slotNote: M.getSlotNote(),
  };
};

/**
 * Données du récapitulatif. Le prix d'une ligne comprend les suppléments de
 * ses options (OPT-a), listées sous l'article (texte vide sans option).
 *
 * @returns {{lines: Array<{text: string, options: string, total: string}>, dealershipShortName: string,
 *   total: string, confirmLabel: string, isDisabled: boolean}}
 */
M.getSummaryData = function () {
  let cents = 0;
  let lines = [];

  for (const item of M.items) {
    let variant = M.findVariant(item.variantId);
    if (variant !== undefined) {
      let options = variant.options.filter((option) => item.optionIds.includes(option.id));
      let unitCents = options.reduce((total, option) => total + M.toCents(option.price), M.toCents(variant.price));
      let lineCents = unitCents * item.quantity;
      cents += lineCents;
      lines.push({
        text: `${M.formatArticle(variant)} × ${item.quantity}`,
        options: options.map((option) => `+ ${option.label} (${formatPrice(option.price)})`).join(" · "),
        total: formatPrice(lineCents / 100),
      });
    }
  }

  let dealership = M.checkout.dealerships.find((candidate) => candidate.id === M.dealershipId);

  return {
    lines,
    dealershipShortName: dealership?.shortName ?? "la concession",
    total: formatPrice(cents / 100),
    confirmLabel: M.isSubmitting ? "Envoi de la commande…" : "Confirmer la commande",
    isDisabled: M.isSubmitting || M.dealershipId === null || M.slotId === null,
  };
};

/**
 * @returns {{number: string, statusLabel: string, dealershipName: string, pickup: string,
 *   countLabel: string, total: string}} Données de la commande enregistrée.
 */
M.getConfirmedData = function () {
  return {
    number: `CMD-${String(M.order.id).padStart(4, "0")}`,
    statusLabel: STATUS_LABELS[M.order.status] ?? M.order.status,
    dealershipName: M.order.dealership.name,
    pickup: M.formatPickup(M.order.pickupStart, M.order.pickupEnd).toLowerCase(),
    countLabel: M.formatCount(M.order.lines.reduce((total, line) => total + line.quantity, 0)),
    total: formatPrice(M.order.total),
  };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: ReturnType<typeof M.getState>, title: string,
 *   steps: ReturnType<typeof M.getSteps>, notice: ?{type: string, texte: string},
 *   error: ?string, unavailable: ?string, contact: ?string, details: ?ReturnType<typeof M.getDetailsData>,
 *   summary: ?ReturnType<typeof M.getSummaryData>, confirmed: ?ReturnType<typeof M.getConfirmedData>}}
 */
M.getViewData = function () {
  let state = M.getState();
  let customer = M.checkout?.customer;

  return {
    state,
    title: TITLES[state],
    steps: M.getSteps(),
    notice: M.notice,
    error: M.error,
    unavailable: M.unavailable,
    contact:
      state === "form"
        ? `${customer.firstName} ${customer.lastName} · ${customer.email} · ${M.formatPhone(customer.phone)}`
        : null,
    details: state === "form" ? M.getDetailsData() : null,
    summary: state === "form" ? M.getSummaryData() : null,
    confirmed: state === "confirmed" ? M.getConfirmedData() : null,
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
 * Choix d'une concession : le choix et le récapitulatif sont reconstruits.
 *
 * @param {number} dealershipId
 */
C.handler_selectDealership = function (dealershipId) {
  M.setDealership(dealershipId);
  V.renderDetails(M.getDetailsData());
  V.renderSummary(M.getSummaryData());
};

/**
 * Choix d'un créneau.
 *
 * @param {string} slotId
 */
C.handler_selectSlot = function (slotId) {
  M.setSlot(slotId);
  V.renderDetails(M.getDetailsData());
};

/**
 * Clic sur « Confirmer la commande ». Pendant l'envoi, le bouton est
 * désactivé ; ensuite, toute la page est reconstruite (confirmation, ou
 * choix avec le message d'erreur).
 *
 * @returns {Promise<void>}
 */
C.handler_confirm = async function () {
  if (!M.startSubmit()) return;
  V.renderSummary(M.getSummaryData());

  await M.submit();

  V.renderPage(M.getViewData());
  V.scrollToTop();
  V.focusContent();
};

/**
 * Clic sur « Réessayer » après une erreur de chargement.
 *
 * @returns {Promise<void>}
 */
C.handler_retry = async function () {
  await M.load();
  V.renderPage(M.getViewData());
  V.focusContent();
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  steps: null, // fil des étapes affiché
  title: null, // titre de la page
  notice: null, // conteneur des messages
  content: null, // zone affichée (choix et récapitulatif, confirmation, connexion…)
  details: null, // bloc des choix (concession, créneau), ou null
  summary: null, // récapitulatif affiché, ou null
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let page = htmlToFragment(genericRenderer(template, { title: data.title }));

  let steps = CheckoutStepsView.dom(data.steps);
  V.steps = steps.firstElementChild;
  page.querySelector('slot[name="steps"]').replaceWith(steps);

  V.title = page.querySelector("[data-checkout-title]");
  V.notice = page.querySelector("[data-checkout-notice]");
  V.renderNotice(data.notice);

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit toute la page affichée : étapes, titre, messages et zone.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.renderPage = function (data) {
  let steps = CheckoutStepsView.dom(data.steps);
  let newSteps = steps.firstElementChild;
  V.steps.replaceWith(steps);
  V.steps = newSteps;

  V.title.textContent = data.title;
  V.renderNotice(data.notice);

  let content = V.createContentFragment(data);
  let newContent = content.firstElementChild;
  V.content.replaceWith(content);
  V.content = newContent;
};

/**
 * Reconstruit le bloc des choix, en gardant le focus sur le bouton radio utilisé.
 *
 * @param {ReturnType<typeof M.getDetailsData>} details
 */
V.renderDetails = function (details) {
  V.details = replaceKeepingFocus(V.details, V.createDetailsFragment(details));
};

/**
 * Reconstruit le récapitulatif.
 *
 * @param {ReturnType<typeof M.getSummaryData>} summary
 */
V.renderSummary = function (summary) {
  V.summary = replaceKeepingFocus(V.summary, V.createSummaryFragment(summary));
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
 * Remonte en haut de la page : sur mobile, le bouton « Confirmer » est tout
 * en bas, loin de la confirmation ou du message.
 */
V.scrollToTop = function () {
  window.scrollTo(0, 0);
};

/**
 * Donne le focus à la zone affichée (le bouton utilisé a disparu avec elle).
 */
V.focusContent = function () {
  V.content.focus();
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} La zone qui correspond à l'état de la page.
 */
V.createContentFragment = function (data) {
  V.details = null;
  V.summary = null;

  if (data.state === "confirmed") {
    return htmlToFragment(genericRenderer(templateConfirmed, data.confirmed));
  }
  if (data.state === "unavailable") {
    return htmlToFragment(genericRenderer(templateUnavailable, { text: data.unavailable }));
  }
  if (data.state === "login") {
    return htmlToFragment(templateLogin);
  }
  if (data.state === "empty") {
    return htmlToFragment(templateEmpty);
  }
  if (data.state === "error") {
    let fragment = htmlToFragment(genericRenderer(templateError, { text: data.error }));
    fragment.querySelector("[data-retry]").addEventListener("click", C.handler_retry);
    return fragment;
  }

  let fragment = htmlToFragment(genericRenderer(templateContent, { contact: data.contact }));

  let details = V.createDetailsFragment(data.details);
  V.details = details.firstElementChild;
  fragment.querySelector('slot[name="details"]').replaceWith(details);

  let summary = V.createSummaryFragment(data.summary);
  V.summary = summary.firstElementChild;
  fragment.querySelector('slot[name="summary"]').replaceWith(summary);

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getDetailsData>} details
 * @returns {DocumentFragment} Les choix de concession et de créneau, reliés au contrôleur.
 */
V.createDetailsFragment = function (details) {
  let fragment = htmlToFragment(genericRenderer(templateDetails, { slotNote: details.slotNote }));

  fragment
    .querySelector('slot[name="dealerships"]')
    .replaceWith(...details.dealerships.map((dealership) => V.createOptionFragment(templateDealership, dealership)));

  let slots =
    details.slots.length > 0
      ? details.slots.map((slot) => V.createOptionFragment(templateSlot, slot))
      : [htmlToFragment(templateNoSlot)];
  fragment.querySelector('slot[name="slots"]').replaceWith(...slots);

  // Délégation : un seul écouteur pour tous les boutons radio du bloc.
  fragment.firstElementChild.addEventListener("change", (ev) => {
    if (ev.target.name === "dealership") {
      C.handler_selectDealership(Number(ev.target.value));
    } else if (ev.target.name === "slot") {
      C.handler_selectSlot(ev.target.value);
    }
  });

  return fragment;
};

/**
 * @param {string} optionTemplate - templateDealership ou templateSlot.
 * @param {{isSelected: boolean}} option - Données du choix.
 * @returns {DocumentFragment} Un choix, coché s'il est sélectionné.
 */
V.createOptionFragment = function (optionTemplate, option) {
  let fragment = htmlToFragment(genericRenderer(optionTemplate, option));
  fragment.querySelector("input").checked = option.isSelected;
  return fragment;
};

/**
 * @param {ReturnType<typeof M.getSummaryData>} summary
 * @returns {DocumentFragment} Le récapitulatif, relié au contrôleur.
 */
V.createSummaryFragment = function (summary) {
  let fragment = htmlToFragment(genericRenderer(templateSummary, summary));

  fragment
    .querySelector('slot[name="lines"]')
    .replaceWith(...summary.lines.map((line) => htmlToFragment(genericRenderer(templateSummaryLine, line))));

  let button = fragment.querySelector("[data-confirm]");
  button.disabled = summary.isDisabled;
  button.addEventListener("click", C.handler_confirm);

  return fragment;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function CheckoutPage() {
  return C.init();
}
