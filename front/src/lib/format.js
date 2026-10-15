/**
 * Petites fonctions de mise en forme, sans dépendance.
 */

/**
 * 149 -> « 2 h 29 »
 */
export function formaterDuree(minutes) {
  const heures = Math.floor(minutes / 60);
  const restant = minutes % 60;

  if (heures === 0) {
    return `${restant} min`;
  }

  return `${heures} h ${String(restant).padStart(2, "0")}`;
}

/**
 * 8.6 -> « 8,6 » (la virgule décimale française)
 */
export function formaterNote(note) {
  return Number(note).toFixed(1).replace(".", ",");
}

/**
 * Calcule une teinte stable à partir d'une chaîne, pour donner à chaque film un
 * visuel qui lui est propre sans charger la moindre image.
 */
export function teinteDepuisTexte(texte) {
  let somme = 0;

  for (const caractere of texte) {
    somme += caractere.codePointAt(0);
  }

  return somme % 360;
}
