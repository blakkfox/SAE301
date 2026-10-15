import { getRequest } from "../lib/api-request.js";

let FilmData = {};

/**
 * Une page du catalogue : GET /api/films?page=…
 *
 * reglages ({ tri, parPage }) n'est fourni qu'après un choix de l'utilisateur.
 * Sans lui, le serveur applique les préférences qu'il a mémorisées.
 *
 * La réponse contient les films et les réglages réellement appliqués :
 * { films, tri, parPage, page, pagesTotal, total }
 */
FilmData.fetchPage = async function (page, reglages) {
  let uri = `films?page=${page}`;

  if (reglages !== undefined) {
    uri += `&tri=${encodeURIComponent(reglages.tri)}&parPage=${reglages.parPage}`;
  }

  return getRequest(uri);
};

export { FilmData };
