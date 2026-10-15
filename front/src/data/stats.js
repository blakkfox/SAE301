import { getRequest } from "../lib/api-request.js";

let StatsData = {};

/**
 * Statistiques du catalogue : GET /api/admin/stats, réservé aux
 * administrateurs (401 sans connexion, 403 sans le rôle admin).
 *
 * { total: 60, noteMoyenne: 8.2, dureeMoyenne: 121,
 *   parGenre: [ { genre: "Drame", nombre: 11 }, ... ] }
 */
StatsData.fetch = async function () {
  return getRequest("admin/stats");
};

export { StatsData };
