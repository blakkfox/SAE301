import { AdminData } from "../../data/admin.js";
import { getStockStatus } from "../../lib/stock.js";
import { genericRenderer, htmlToFragment, replaceKeepingFocus } from "../../lib/utils.js";
import { MessageView } from "../../ui/message/index.js";
import { RevenueChartView } from "../../ui/revenue-chart/index.js";
import { StatCardView } from "../../ui/stat-card/index.js";
import template from "./template.html?raw";
import templateContent from "./content.html?raw";
import templatePeriod from "./period.html?raw";
import templateLoading from "./loading.html?raw";
import templateBestSellers from "./best-sellers.html?raw";
import templateBestSellerRow from "./best-seller-row.html?raw";
import templateBestSellersEmpty from "./best-sellers-empty.html?raw";
import templateStock from "./stock.html?raw";
import templateStockRow from "./stock-row.html?raw";
import templateStockEmpty from "./stock-empty.html?raw";
import templateAlerts from "./alerts.html?raw";
import templateAlertRow from "./alert-row.html?raw";
import templateAlertsEmpty from "./alerts-empty.html?raw";
import templateLogin from "./login.html?raw";
import templateError from "./error.html?raw";

/**
 * Page « Statistiques » — US PIL-a (écran Figma n° 20), route
 * /admin/statistiques.
 *
 * Pour la période choisie (7 jours, 30 jours, année en cours) : revenus et
 * commandes, comparés à la période précédente ; en ce moment : commandes en
 * cours et disponibles ; depuis l'ouverture : commandes annulées. Puis les
 * revenus des 7 derniers jours, les produits les plus vendus, le stock de
 * chaque produit en ligne et les alertes de stock. « Exporter en CSV »
 * télécharge ces chiffres, calculés à partir de la réponse déjà affichée.
 *
 * Les revenus sont ceux des commandes retirées (paiement sur place), comptés
 * le jour du retrait : ils dépendent donc des statuts gérés en PIL-b.
 * Tout est calculé par le serveur ; la page ne fait que mettre en forme.
 *
 * Découpage MVC strict :
 *   M — statistiques, période, état de la page, export, appels à l'API ;
 *   V — construction du DOM à partir des données REÇUES en paramètre ;
 *   C — réaction aux actions de l'utilisateur, seul lien entre M et V.
 */

// Périodes, dans l'ordre de la maquette (clés de STATS_PERIODS dans
// AdminController). cardLabel complète « Revenus (…) » ; comparison suit
// l'écart avec la période précédente ; fileLabel entre dans le nom de l'export.
const PERIODS = [
  { period: "7", label: "7 jours", cardLabel: "7 jours", comparison: "vs semaine précédente", fileLabel: "7-jours" },
  { period: "30", label: "30 jours", cardLabel: "30 jours", comparison: "vs mois précédent", fileLabel: "30-jours" },
  {
    period: "year",
    label: "Cette année",
    cardLabel: "cette année",
    comparison: "vs l’an dernier à la même date",
    fileLabel: "annee",
  },
];

// Montants arrondis à l'euro, comme la maquette (« 6 482 € »).
const ROUNDED_PRICE = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

// Écart en pourcentage, avec son signe (« +8 », « -3 », « 0 »).
const SIGNED_PERCENT = new Intl.NumberFormat("fr-FR", { signDisplay: "exceptZero" });

// Jours du graphique. Les dates de l'API sont des jours du calendrier, lus en UTC.
const SHORT_WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" });
const LONG_DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

// Hauteur de la barre la plus haute, en % de la colonne : le montant reste au-dessus.
const CHART_MAX_SIZE = 80;

// Classes d'une jauge de stock, écrites en entier (voir .meter dans global.css).
const METER_CLASSES = { in: "", low: "meter--low", out: "meter--out" };

// État d'un stock, pour les lecteurs d'écran.
const STOCK_WORDS = { in: "en stock", low: "bientôt épuisé", out: "épuisé" };

// Classes d'une alerte de stock, comme le tableau de bord : le texte « 2
// restants » reste en gris anthracite, l'orange n'est pas assez contrasté.
const ALERT_CLASSES = {
  out: { dot: "bg-error", quantity: "text-accent" },
  low: { dot: "bg-warning", quantity: "text-ink" },
};

const SERVER_DOWN = "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.";

// ---------------------------------------------------------------------------
// M — Modèle
// ---------------------------------------------------------------------------

let M = {
  stats: null, // réponse de GET /api/admin/stats, ou null
  period: "30", // période demandée à l'API
  request: 0, // numéro de la dernière demande : les réponses plus anciennes sont ignorées
  state: "stats", // "stats", "login" ou "error"
  isLoading: false, // les statistiques sont en cours de chargement
  errorMessage: "", // message de l'état "error"
  notice: null, // { type, texte } au-dessus du contenu, ou null
};

/**
 * Remet la page dans son état initial.
 */
M.reset = function () {
  M.stats = null;
  M.period = "30";
  M.state = "stats";
  M.isLoading = false;
  M.errorMessage = "";
  M.notice = null;
};

/**
 * Refus du serveur (401, 403) : la page affiche la connexion.
 *
 * @param {ErreurApi} error
 * @returns {boolean} true si l'erreur était un refus d'accès.
 */
M.handleAccessError = function (error) {
  if (error.statut !== 401 && error.statut !== 403) return false;

  M.state = "login";
  M.notice =
    error.statut === 403
      ? { type: "erreur", texte: "Vous êtes connecté avec un compte client. Connectez-vous avec un compte administrateur." }
      : null;
  return true;
};

/**
 * Charge les statistiques de M.period. Le serveur rappelle la période
 * appliquée : M.period la reprend. Si des statistiques sont déjà affichées,
 * une erreur s'affiche en message et elles restent.
 *
 * @returns {Promise<void>}
 */
M.load = async function () {
  let request = ++M.request;
  M.isLoading = true;

  try {
    let stats = await AdminData.fetchStats(M.period);
    if (request !== M.request) return;

    M.stats = stats;
    M.period = stats.period;
    M.state = "stats";
  } catch (error) {
    if (request !== M.request || M.handleAccessError(error)) return;

    let message = error.statut === undefined ? SERVER_DOWN : `Impossible de charger les statistiques : ${error.message}`;
    if (M.stats === null) {
      M.state = "error";
      M.errorMessage = message;
    } else {
      M.notice = { type: "erreur", texte: message };
    }
  } finally {
    if (request === M.request) M.isLoading = false;
  }
};

/**
 * Choix d'une période. Le message précédent est effacé.
 *
 * @param {string} period
 * @returns {boolean} false si la période est inconnue ou déjà demandée.
 */
M.setPeriod = function (period) {
  if (period === M.period || !PERIODS.some((item) => item.period === period)) return false;

  M.period = period;
  M.notice = null;
  return true;
};

/**
 * @returns {(typeof PERIODS)[number]} La période demandée.
 */
M.getPeriod = function () {
  return PERIODS.find((item) => item.period === M.period);
};

/**
 * @param {number} count
 * @param {string} singular - Par exemple « vente ».
 * @param {string} plural - Par exemple « ventes ».
 * @returns {string} « 1 vente », « 48 ventes »…
 */
M.formatCount = function (count, singular, plural) {
  return `${count} ${count > 1 ? plural : singular}`;
};

/**
 * Écart avec la période précédente, pour la précision d'une carte.
 *
 * @param {number} current - Valeur de la période.
 * @param {number} previous - Valeur de la période précédente.
 * @param {string} comparison - Par exemple « vs mois précédent ».
 * @returns {{caption: string, trend: "none"|"up"|"down"}}
 */
M.formatVariation = function (current, previous, comparison) {
  if (previous === 0) {
    return current === 0
      ? { caption: `Aucun écart ${comparison}`, trend: "none" }
      : { caption: "Rien sur la période précédente", trend: "up" };
  }

  let percent = Math.round(((current - previous) / previous) * 100);

  return {
    caption: `${SIGNED_PERCENT.format(percent)} % ${comparison}`,
    trend: percent > 0 ? "up" : percent < 0 ? "down" : "none",
  };
};

/**
 * @returns {Array<{label: string, value: string, caption: string, tone: "default", trend: "none"|"up"|"down"}>}
 *   Les quatre cartes indicateurs, dans l'ordre de la maquette.
 */
M.getCards = function () {
  let stats = M.stats.stats;
  let period = M.getPeriod();

  return [
    {
      label: `Revenus (${period.cardLabel})`,
      value: ROUNDED_PRICE.format(stats.revenue),
      tone: "default",
      ...M.formatVariation(stats.revenue, stats.previousRevenue, period.comparison),
    },
    {
      label: "Commandes",
      value: String(stats.orderCount),
      tone: "default",
      ...M.formatVariation(stats.orderCount, stats.previousOrderCount, period.comparison),
    },
    {
      label: "Commandes en cours",
      value: String(stats.inProgressCount),
      caption: `+ ${M.formatCount(stats.availableCount, "disponible", "disponibles")} au retrait`,
      tone: "default",
      trend: "none",
    },
    {
      label: "Commandes annulées",
      value: String(stats.cancelledCount),
      caption: "depuis l’ouverture",
      tone: "default",
      trend: "none",
    },
  ];
};

/**
 * @param {string} date - Jour du calendrier, « 2026-10-21 ».
 * @returns {Date} Ce jour à minuit UTC, pour les formats lus en UTC.
 */
M.toUtcDate = function (date) {
  return new Date(`${date}T00:00:00Z`);
};

/**
 * @returns {{bars: Array<{day: string, amount: string, size: number, isToday: boolean, description: string}>,
 *   isEmpty: boolean}}
 *   Les barres du graphique, aujourd'hui en dernier, et l'absence de tout revenu.
 */
M.getChart = function () {
  let days = M.stats.dailyRevenue;
  let max = Math.max(0, ...days.map((day) => day.revenue));

  let bars = days.map((day, index) => {
    let isToday = index === days.length - 1;
    let isClosed = day.isClosed && day.revenue === 0;
    let amount = isClosed ? "fermé" : ROUNDED_PRICE.format(day.revenue);
    let weekday = SHORT_WEEKDAY.format(M.toUtcDate(day.date)).replace(".", "");

    return {
      day: weekday.charAt(0).toUpperCase() + weekday.slice(1),
      amount,
      size: max === 0 ? 0 : Math.round((day.revenue / max) * CHART_MAX_SIZE),
      isToday,
      description: `${LONG_DAY.format(M.toUtcDate(day.date))}${isToday ? " (aujourd’hui)" : ""} : ${
        isClosed ? "concession fermée" : amount
      }`,
    };
  });

  return { bars, isEmpty: max === 0 };
};

/**
 * @returns {Array<{rank: number, name: string, quantity: string}>} Les meilleures ventes.
 */
M.getBestSellers = function () {
  return M.stats.bestSellers.map((product, index) => ({
    rank: index + 1,
    name: product.name,
    quantity: M.formatCount(product.quantity, "vente", "ventes"),
  }));
};

/**
 * @param {number[]} thresholds - Seuils « Bientôt épuisé » des produits.
 * @returns {string} La légende du stock : un seuil commun, ou leur étendue.
 */
M.formatThresholds = function (thresholds) {
  if (thresholds.length === 0) return "";

  let min = Math.min(...thresholds);
  let max = Math.max(...thresholds);

  return min === max
    ? `Seuil « Bientôt épuisé » : ${M.formatCount(min, "unité", "unités")}`
    : `Seuil « Bientôt épuisé » : de ${min} à ${max} unités selon le produit`;
};

/**
 * @returns {{rows: Array<{name: string, stock: number, size: number, status: "in"|"low"|"out",
 *   stockDescription: string}>, thresholdLabel: string}}
 *   Une jauge par produit, proportionnelle au stock le plus haut.
 */
M.getStock = function () {
  let products = M.stats.stock;
  let max = Math.max(1, ...products.map((product) => product.stock));

  return {
    rows: products.map((product) => {
      let status = getStockStatus(product.stock, product.lowStockThreshold);
      return {
        name: product.name,
        stock: product.stock,
        size: Math.round((product.stock / max) * 100),
        status,
        stockDescription: `${M.formatCount(product.stock, "unité", "unités")}, ${STOCK_WORDS[status]}`,
      };
    }),
    thresholdLabel: M.formatThresholds(products.map((product) => product.lowStockThreshold)),
  };
};

/**
 * @returns {{rows: Array<{name: string, quantity: string, status: "low"|"out"}>,
 *   moreLabel: string, moreCount: number}}
 *   Les alertes détaillées, puis le nombre de celles qui ne le sont pas.
 */
M.getAlerts = function () {
  let moreCount = M.stats.stockAlertCount - M.stats.stockAlerts.length;

  return {
    rows: M.stats.stockAlerts.map((alert) => ({
      // « Unique » : produit sans déclinaison, le nom suffit.
      name: alert.label === "Unique" ? alert.name : `${alert.name} · ${alert.label}`,
      quantity: alert.stock === 0 ? "épuisé" : M.formatCount(alert.stock, "restant", "restants"),
      status: getStockStatus(alert.stock, alert.lowStockThreshold),
    })),
    moreLabel: M.formatCount(moreCount, "autre variante", "autres variantes"),
    moreCount,
  };
};

/**
 * Cellule CSV : entre guillemets, guillemets doublés. Un texte qui commence
 * par = + - @ reçoit une apostrophe, pour qu'un tableur ne l'exécute pas
 * comme une formule (nom de produit saisi au back-office).
 *
 * @param {string|number} value
 * @returns {string}
 */
M.csvCell = function (value) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

/**
 * @param {number} amount - Montant en euros.
 * @returns {string} Le montant pour un tableur français, « 6482,50 ».
 */
M.csvAmount = function (amount) {
  return amount.toFixed(2).replace(".", ",");
};

/**
 * @param {string} date - « 2026-10-21 ».
 * @returns {string} « 21/10/2026 ».
 */
M.csvDate = function (date) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
};

/**
 * Fichier CSV des statistiques affichées : séparateur « ; » et BOM UTF-8,
 * pour qu'Excel ouvre directement colonnes et accents.
 *
 * @returns {{filename: string, content: string}}
 */
M.getCsvExport = function () {
  let stats = M.stats.stats;
  let period = M.getPeriod();
  let today = M.stats.dailyRevenue[M.stats.dailyRevenue.length - 1].date;

  let rows = [
    ["Statistiques Honda Moto Lyon Centre", period.label, `au ${M.csvDate(today)}`],
    [],
    ["Indicateur", "Période", "Période précédente"],
    ["Revenus en € (commandes retirées)", M.csvAmount(stats.revenue), M.csvAmount(stats.previousRevenue)],
    ["Commandes (hors annulées)", stats.orderCount, stats.previousOrderCount],
    ["Commandes en cours", stats.inProgressCount],
    ["Commandes disponibles au retrait", stats.availableCount],
    ["Commandes annulées depuis l’ouverture", stats.cancelledCount],
    [],
    ["Revenus des 7 derniers jours"],
    ["Date", "Revenus en €"],
    ...M.stats.dailyRevenue.map((day) => [M.csvDate(day.date), M.csvAmount(day.revenue)]),
    [],
    ["Produits les plus vendus", period.label],
    ["Rang", "Produit", "Ventes"],
    ...M.stats.bestSellers.map((product, index) => [index + 1, product.name, product.quantity]),
    [],
    ["Stock par produit"],
    ["Produit", "Stock", "Seuil « Bientôt épuisé »"],
    ...M.stats.stock.map((product) => [product.name, product.stock, product.lowStockThreshold]),
  ];

  return {
    filename: `statistiques-${period.fileLabel}-${today}.csv`,
    content: "﻿" + rows.map((row) => row.map(M.csvCell).join(";")).join("\r\n"),
  };
};

/**
 * Après le téléchargement : message de confirmation.
 *
 * @param {string} filename
 */
M.setExportNotice = function (filename) {
  M.notice = { type: "succes", texte: `Export téléchargé : ${filename}.` };
};

/**
 * Tout ce que la Vue doit afficher, déjà préparé.
 *
 * @returns {{state: "stats"|"login"|"error", notice: ?{type: string, texte: string}, errorMessage: string,
 *   content: ?{adminLabel: string, periodLabel: string, isLoading: boolean,
 *     periods: Array<{period: string, label: string, isActive: boolean}>,
 *     cards: ReturnType<typeof M.getCards>, chart: ReturnType<typeof M.getChart>,
 *     bestSellers: ReturnType<typeof M.getBestSellers>, stock: ReturnType<typeof M.getStock>,
 *     alerts: ReturnType<typeof M.getAlerts>}}}
 */
M.getViewData = function () {
  return {
    state: M.state,
    notice: M.notice,
    errorMessage: M.errorMessage,
    content:
      M.stats === null
        ? null
        : {
            adminLabel: `${M.stats.admin.firstName} (admin) · Lyon Centre`,
            periodLabel: M.getPeriod().label,
            isLoading: M.isLoading,
            periods: PERIODS.map((item) => ({ period: item.period, label: item.label, isActive: item.period === M.period })),
            cards: M.getCards(),
            chart: M.getChart(),
            bestSellers: M.getBestSellers(),
            stock: M.getStock(),
            alerts: M.getAlerts(),
          },
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
 * Clic sur une pastille de période.
 *
 * @param {string} period
 * @returns {Promise<void>}
 */
C.handler_period = async function (period) {
  if (!M.setPeriod(period)) return;

  V.render(M.getViewData());
  await M.load();
  V.render(M.getViewData());
};

/**
 * Clic sur « Exporter en CSV ».
 */
C.handler_export = function () {
  let file = M.getCsvExport();
  V.downloadFile(file.filename, file.content);

  M.setExportNotice(file.filename);
  V.render(M.getViewData());
};

/**
 * Clic sur « Réessayer » (état "error").
 *
 * @returns {Promise<void>}
 */
C.handler_retry = async function () {
  await M.load();
  V.render(M.getViewData());
};

// ---------------------------------------------------------------------------
// V — Vue
// ---------------------------------------------------------------------------

let V = {
  content: null, // contenu affiché : statistiques, connexion ou erreur
  notice: null, // conteneur des messages
};

/**
 * Premier affichage de la page.
 *
 * @param {ReturnType<typeof M.getViewData>} data - Données préparées par le modèle.
 * @returns {DocumentFragment}
 */
V.init = function (data) {
  let page = htmlToFragment(template);

  V.notice = page.querySelector("[data-stats-notice]");
  V.notice.replaceChildren(MessageView.dom(data.notice));

  let content = V.createContentFragment(data);
  V.content = content.firstElementChild;
  page.querySelector('slot[name="content"]').replaceWith(content);

  return page;
};

/**
 * Reconstruit le contenu et les messages à partir de l'état.
 *
 * @param {ReturnType<typeof M.getViewData>} data
 */
V.render = function (data) {
  V.notice.replaceChildren(MessageView.dom(data.notice));
  V.content = replaceKeepingFocus(V.content, V.createContentFragment(data));
};

/**
 * Télécharge un fichier produit dans le navigateur, sans passer par le
 * serveur (l'API ne répond qu'en JSON).
 *
 * @param {string} filename
 * @param {string} content - Contenu du fichier CSV.
 */
V.downloadFile = function (filename, content) {
  let url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  let link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/**
 * @param {ReturnType<typeof M.getViewData>} data
 * @returns {DocumentFragment} Le contenu de l'état courant.
 */
V.createContentFragment = function (data) {
  if (data.state === "login") {
    return htmlToFragment(templateLogin);
  }

  if (data.state === "error" || data.content === null) {
    let fragment = htmlToFragment(genericRenderer(templateError, { message: data.errorMessage }));
    fragment.querySelector('[data-action="retry"]').addEventListener("click", C.handler_retry);
    return fragment;
  }

  return V.createStatsFragment(data.content);
};

/**
 * @param {NonNullable<ReturnType<typeof M.getViewData>["content"]>} content
 * @returns {DocumentFragment} Toute la page de statistiques.
 */
V.createStatsFragment = function (content) {
  let fragment = htmlToFragment(
    genericRenderer(templateContent, { adminLabel: content.adminLabel, periodLabel: content.periodLabel }),
  );

  let exportButton = fragment.querySelector('[data-action="export"]');
  exportButton.disabled = content.isLoading;
  exportButton.addEventListener("click", C.handler_export);

  fragment.querySelector('slot[name="periods"]').replaceWith(V.createPeriodsFragment(content.periods));
  fragment.querySelector("[data-periods]").addEventListener("click", (ev) => {
    let button = ev.target.closest("button[data-period]");
    if (button === null || button.getAttribute("aria-pressed") === "true") return;
    C.handler_period(button.dataset.period);
  });

  fragment
    .querySelector('slot[name="loading"]')
    .replaceWith(content.isLoading ? htmlToFragment(templateLoading) : document.createDocumentFragment());

  let cards = document.createDocumentFragment();
  cards.append(...content.cards.map((card) => StatCardView.dom(card)));
  fragment.querySelector('slot[name="stats"]').replaceWith(cards);

  fragment.querySelector('slot[name="chart"]').replaceWith(RevenueChartView.dom(content.chart.bars));
  fragment.querySelector("[data-chart-empty]").hidden = !content.chart.isEmpty;

  fragment.querySelector('slot[name="best-sellers"]').replaceWith(V.createBestSellersFragment(content.bestSellers));
  fragment.querySelector('slot[name="stock"]').replaceWith(V.createStockFragment(content.stock));
  fragment.querySelector('slot[name="alerts"]').replaceWith(V.createAlertsFragment(content.alerts));

  return fragment;
};

/**
 * @param {NonNullable<ReturnType<typeof M.getViewData>["content"]>["periods"]} periods
 * @returns {DocumentFragment} Les pastilles de période, celle appliquée pressée.
 */
V.createPeriodsFragment = function (periods) {
  let fragment = document.createDocumentFragment();

  fragment.append(
    ...periods.map((period) => {
      let item = htmlToFragment(genericRenderer(templatePeriod, { period: period.period, label: period.label }));
      item.querySelector("button").setAttribute("aria-pressed", String(period.isActive));
      return item;
    }),
  );

  return fragment;
};

/**
 * @param {ReturnType<typeof M.getBestSellers>} bestSellers
 * @returns {DocumentFragment} Le classement, ou le message « aucune vente ».
 */
V.createBestSellersFragment = function (bestSellers) {
  if (bestSellers.length === 0) {
    return htmlToFragment(templateBestSellersEmpty);
  }

  let fragment = htmlToFragment(templateBestSellers);
  fragment
    .querySelector("[data-best-seller-rows]")
    .append(...bestSellers.map((row) => htmlToFragment(genericRenderer(templateBestSellerRow, row))));
  return fragment;
};

/**
 * @param {ReturnType<typeof M.getStock>} stock
 * @returns {DocumentFragment} Les jauges de stock et leur légende, ou le message « aucun produit ».
 */
V.createStockFragment = function (stock) {
  if (stock.rows.length === 0) {
    return htmlToFragment(templateStockEmpty);
  }

  let fragment = htmlToFragment(genericRenderer(templateStock, { thresholdLabel: stock.thresholdLabel }));
  fragment.querySelector("[data-stock-rows]").append(
    ...stock.rows.map((row) =>
      htmlToFragment(
        genericRenderer(templateStockRow, {
          name: row.name,
          stock: row.stock,
          size: row.size,
          meterClass: METER_CLASSES[row.status],
          stockDescription: row.stockDescription,
        }),
      ),
    ),
  );
  return fragment;
};

/**
 * @param {ReturnType<typeof M.getAlerts>} alerts
 * @returns {DocumentFragment} La liste des alertes, ou le message « aucune alerte ».
 */
V.createAlertsFragment = function (alerts) {
  if (alerts.rows.length === 0) {
    return htmlToFragment(templateAlertsEmpty);
  }

  let fragment = htmlToFragment(genericRenderer(templateAlerts, { moreLabel: alerts.moreLabel }));
  fragment.querySelector("[data-alert-rows]").append(
    ...alerts.rows.map((row) =>
      htmlToFragment(
        genericRenderer(templateAlertRow, {
          name: row.name,
          quantity: row.quantity,
          dotClass: ALERT_CLASSES[row.status].dot,
          quantityClass: ALERT_CLASSES[row.status].quantity,
        }),
      ),
    ),
  );
  fragment.querySelector("[data-alert-more]").hidden = alerts.moreCount === 0;
  return fragment;
};

/**
 * Page exportée vers le routeur (voir main.js).
 *
 * @returns {Promise<DocumentFragment>}
 */
export function AdminStatsPage() {
  return C.init();
}
