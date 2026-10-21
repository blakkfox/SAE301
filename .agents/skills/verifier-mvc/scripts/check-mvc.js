#!/usr/bin/env node
/**
 * Vérification du découpage MVC des pages et de l'absence de foreach.
 *
 * Usage : node .agents/skills/verifier-mvc/scripts/check-mvc.js [racine du dépôt]
 *
 * Contrôles :
 *   1. chaque page dynamique (front/src/pages/<nom>/page.js) déclare M, V et C,
 *      ainsi que C.init ;
 *   2. M ne référence ni V ni C et ne touche pas au DOM ;
 *   3. V ne référence pas M ;
 *   4. C est la passerelle : il référence M et V, et ne touche au DOM que via
 *      l'événement reçu (ev.…) ;
 *   5. la fonction exportée renvoie C.init() sans passer par M ou V ;
 *   6. un composant UI (front/src/ui/<nom>/index.js) n'importe rien de data/ :
 *      il reçoit ses données, il ne les choisit pas ;
 *   7. aucun foreach (PHP) ni .forEach() (JS).
 *
 * Les commentaires et les chaînes sont neutralisés avant l'analyse : un
 * « M.getViewData » cité dans un JSDoc de la Vue n'est pas une référence.
 *
 * Code de sortie : 0 si aucune erreur, 1 sinon (les avertissements ne bloquent pas).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.argv[2] || ".");
const PAGES_DIR = path.join(ROOT, "front", "src", "pages");
const UI_DIR = path.join(ROOT, "front", "src", "ui");
const FRONT_SRC_DIR = path.join(ROOT, "front", "src");
const BACK_DIR = path.join(ROOT, "back");

// Accès au DOM ou au navigateur interdits dans M (et dans C hors de ev).
const DOM_PATTERN =
  /\b(document|window|navigator|addEventListener|removeEventListener|querySelector|querySelectorAll|getElementById|innerHTML|outerHTML|textContent|classList|dataset|replaceWith|appendChild|htmlToFragment|closest|setAttribute|scrollTo)\b/;

// Caractères après lesquels un « / » ouvre une expression régulière.
const REGEX_PRECEDERS = "(,=:[!&|?{};+-*%<>~^";

let report = { errors: [], warnings: [], infos: [] };

/**
 * Ajoute une entrée au rapport.
 *
 * @param {"errors"|"warnings"|"infos"} level
 * @param {string} file - Chemin absolu du fichier concerné.
 * @param {number} line - Numéro de ligne (0 si sans objet).
 * @param {string} message
 */
function add(level, file, line, message) {
  report[level].push({ file: path.relative(ROOT, file), line, message });
}

/**
 * Remplace par des espaces le contenu des commentaires, des chaînes et des
 * expressions régulières, en gardant les retours à la ligne (les numéros de
 * ligne restent justes). Les expressions ${…} des templates JS sont gardées.
 *
 * @param {string} source
 * @param {"js"|"php"} lang
 * @returns {string} Le code « nu », de même longueur que la source.
 */
function stripCode(source, lang) {
  let out = source.split("");
  let blank = (from, to) => {
    for (let k = from; k < to; k++) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };
  // Pile des templates JS ouverts : chaque entrée compte les { du ${…} en cours.
  let templateStack = [];
  let lastSignificant = "";
  let i = 0;

  while (i < source.length) {
    let ch = source[i];
    let next = source[i + 1];

    if (ch === "/" && next === "/") {
      let end = source.indexOf("\n", i);
      end = end === -1 ? source.length : end;
      blank(i, end);
      i = end;
      continue;
    }
    if (lang === "php" && ch === "#" && next !== "[") {
      let end = source.indexOf("\n", i);
      end = end === -1 ? source.length : end;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      let end = source.indexOf("*/", i + 2);
      end = end === -1 ? source.length : end + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || (lang === "php" && ch === "`")) {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        j += source[j] === "\\" ? 2 : 1;
      }
      blank(i + 1, j);
      i = j + 1;
      lastSignificant = ch;
      continue;
    }
    if (lang === "js" && (ch === "`" || (ch === "}" && templateStack.length > 0 && templateStack[templateStack.length - 1] === 0))) {
      // Début d'un template, ou retour dans le template après un ${…}.
      if (ch === "}") templateStack.pop();
      let j = i + 1;
      while (j < source.length && source[j] !== "`" && !(source[j] === "$" && source[j + 1] === "{")) {
        j += source[j] === "\\" ? 2 : 1;
      }
      blank(i + 1, j);
      if (source[j] === "$") {
        templateStack.push(0);
        i = j + 2;
      } else {
        i = j + 1;
      }
      lastSignificant = "`";
      continue;
    }
    if (lang === "js" && ch === "/" && (lastSignificant === "" || REGEX_PRECEDERS.includes(lastSignificant))) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== "\n" && (inClass || source[j] !== "/")) {
        if (source[j] === "\\") j++;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      lastSignificant = "/";
      continue;
    }
    if (lang === "js" && templateStack.length > 0) {
      if (ch === "{") templateStack[templateStack.length - 1]++;
      if (ch === "}") templateStack[templateStack.length - 1]--;
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
    i++;
  }
  return out.join("");
}

/**
 * Liste récursivement les fichiers d'un dossier ayant l'une des extensions.
 *
 * @param {string} dir
 * @param {string[]} extensions - Par exemple [".js"].
 * @returns {string[]} Chemins absolus ; tableau vide si le dossier n'existe pas.
 */
function listFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  let entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (let k = 0; k < entries.length; k++) {
    let entry = entries[k];
    let full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== "vendor") {
        files = files.concat(listFiles(full, extensions));
      }
    } else if (extensions.includes(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Attribue chaque ligne du code nu à son propriétaire : la ligne qui commence
 * en colonne 0 par « M. », « let V » ou « export » ouvre un bloc, les lignes
 * indentées le prolongent.
 *
 * @param {string[]} lines - Lignes du code nu.
 * @returns {string[]} Pour chaque ligne : "M", "V", "C", "export" ou "other".
 */
function assignOwners(lines) {
  let owners = [];
  let current = "other";
  for (let k = 0; k < lines.length; k++) {
    let line = lines[k];
    let declaration = line.match(/^(?:let|const|var)\s+([MVC])\b/);
    let property = line.match(/^([MVC])\.\w+\s*=/);
    if (declaration) current = declaration[1];
    else if (property) current = property[1];
    else if (/^export\b/.test(line)) current = "export";
    else if (/^(import|let|const|var|function|class)\b/.test(line)) current = "other";
    owners.push(current);
  }
  return owners;
}

/**
 * Cherche un motif dans les lignes d'un propriétaire donné.
 *
 * @param {string[]} lines
 * @param {string[]} owners
 * @param {string} owner
 * @param {RegExp} pattern
 * @returns {Array<{line: number, match: string}>} Occurrences (lignes numérotées à partir de 1).
 */
function findIn(lines, owners, owner, pattern) {
  let found = [];
  for (let k = 0; k < lines.length; k++) {
    if (owners[k] !== owner) continue;
    let match = lines[k].match(pattern);
    if (match) found.push({ line: k + 1, match: match[0] });
  }
  return found;
}

/**
 * Applique les contrôles MVC à une page.
 *
 * @param {string} file - Chemin absolu de page.js.
 */
function checkPage(file) {
  let stripped = stripCode(fs.readFileSync(file, "utf8"), "js");
  let lines = stripped.split("\n");
  let owners = assignOwners(lines);
  let declared = ["M", "V", "C"].filter((name) => new RegExp(`^(?:let|const|var)\\s+${name}\\b`, "m").test(stripped));

  if (declared.length === 0) {
    add("infos", file, 0, "page statique (ni M, ni V, ni C) : non contrôlée");
    return;
  }
  ["M", "V", "C"]
    .filter((name) => !declared.includes(name))
    .map((name) => add("errors", file, 0, `l'objet ${name} n'est pas déclaré (let ${name} = …)`));

  if (!/^C\.init\s*=/m.test(stripped)) add("errors", file, 0, "C.init n'est pas défini");

  let flag = (level, owner, pattern, message) =>
    findIn(lines, owners, owner, pattern).map((hit) => add(level, file, hit.line, `${message} (« ${hit.match} »)`));

  // M : ni V, ni C, ni DOM.
  flag("errors", "M", /\bV\s*\.\s*\w+/, "M référence la Vue");
  flag("errors", "M", /\bC\s*\.\s*\w+/, "M référence le Contrôleur : seul C fait le lien entre M et V");
  flag("errors", "M", DOM_PATTERN, "M accède au DOM ou au navigateur");

  // V : jamais M.
  flag("errors", "V", /\bM\s*\.\s*\w+/, "V référence le Modèle : les données doivent arriver en paramètre");

  // C : DOM uniquement via l'événement reçu.
  let controllerLines = lines.map((line, k) => (owners[k] === "C" ? line.replace(/\b(ev|event)(\.\w+)+/g, "") : ""));
  findIn(controllerLines, owners, "C", DOM_PATTERN).map((hit) =>
    add("errors", file, hit.line, `C accède au DOM hors de l'événement reçu (« ${hit.match} »)`)
  );

  // C est la passerelle : il doit utiliser M et V.
  if (declared.includes("C")) {
    if (findIn(lines, owners, "C", /\bM\s*\.\s*\w+/).length === 0) add("errors", file, 0, "C n'utilise jamais M : ce n'est pas une passerelle");
    if (findIn(lines, owners, "C", /\bV\s*\.\s*\w+/).length === 0) add("errors", file, 0, "C n'utilise jamais V : ce n'est pas une passerelle");
  }

  // Les événements déclarés par V doivent aboutir à un handler de C.
  let hasHandlers = /^C\.handler_\w+\s*=/m.test(stripped);
  if (hasHandlers && findIn(lines, owners, "V", /\bC\.handler_\w+/).length === 0) {
    add("warnings", file, 0, "C a des handlers mais V ne les branche jamais (C.handler_…)");
  }
  flag("warnings", "C", /^C\.(?!init\b|handler_)\w+\s*=/, "méthode de C qui n'est ni init ni handler_ : vérifier qu'elle n'appartient pas à M ou V");

  // Fonction exportée : renvoie C.init(), rien d'autre.
  let exported = lines.filter((line, k) => owners[k] === "export").join("\n");
  if (exported !== "" && !/\bC\.init\s*\(/.test(exported)) add("errors", file, 0, "la fonction exportée n'appelle pas C.init()");
  flag("errors", "export", /\b[MV]\s*\.\s*\w+/, "la fonction exportée doit passer par C, pas par M ou V");

  // Code hors des objets qui touche à M, V ou C.
  flag("warnings", "other", /\b[MVC]\s*\.\s*\w+/, "code hors de M, V et C qui les référence");
}

/**
 * Vérifie qu'un composant UI ne va pas chercher ses données lui-même.
 *
 * @param {string} file
 */
function checkComponent(file) {
  let source = fs.readFileSync(file, "utf8");
  let lines = source.split("\n");
  for (let k = 0; k < lines.length; k++) {
    if (/^\s*import\b.*from\s+["'][./]*\/?data\//.test(lines[k])) {
      add("errors", file, k + 1, "un composant UI importe data/ : il doit recevoir ses données en paramètre");
    }
  }
}

/**
 * Signale toute boucle foreach (PHP) ou .forEach() (JS).
 *
 * @param {string} file
 * @param {"js"|"php"} lang
 */
function checkForeach(file, lang) {
  let lines = stripCode(fs.readFileSync(file, "utf8"), lang).split("\n");
  let pattern = lang === "php" ? /\bforeach\b/i : /\.\s*forEach\s*\(/;
  for (let k = 0; k < lines.length; k++) {
    if (pattern.test(lines[k])) add("errors", file, k + 1, lang === "php" ? "foreach interdit" : ".forEach() interdit");
  }
}

/**
 * Affiche le rapport groupé par niveau.
 *
 * @param {number} pageCount
 * @param {number} componentCount
 * @param {number} scannedCount
 */
function printReport(pageCount, componentCount, scannedCount) {
  let sections = [
    ["errors", "✖ Erreurs"],
    ["warnings", "⚠ Avertissements"],
    ["infos", "ℹ Informations"],
  ];
  console.log(`Vérification MVC — ${ROOT}`);
  console.log(`${pageCount} page(s), ${componentCount} composant(s) UI, ${scannedCount} fichier(s) analysés pour foreach.\n`);
  for (let s = 0; s < sections.length; s++) {
    let entries = report[sections[s][0]];
    if (entries.length === 0) continue;
    console.log(`${sections[s][1]} (${entries.length})`);
    for (let k = 0; k < entries.length; k++) {
      let e = entries[k];
      console.log(`  ${e.file}${e.line > 0 ? ":" + e.line : ""} — ${e.message}`);
    }
    console.log("");
  }
  console.log(report.errors.length === 0 ? "✔ Découpage MVC respecté." : `✖ ${report.errors.length} erreur(s) à corriger.`);
}

if (!fs.existsSync(PAGES_DIR)) {
  console.error(`Dossier introuvable : ${PAGES_DIR}\nLancer le script depuis la racine du dépôt, ou lui passer la racine en argument.`);
  process.exit(2);
}

let pages = listFiles(PAGES_DIR, [".js"]).filter((file) => path.basename(file) === "page.js");
let components = listFiles(UI_DIR, [".js"]).filter((file) => path.basename(file) === "index.js");
let jsFiles = listFiles(FRONT_SRC_DIR, [".js"]);
let phpFiles = listFiles(BACK_DIR, [".php"]);

pages.map(checkPage);
components.map(checkComponent);
jsFiles.map((file) => checkForeach(file, "js"));
phpFiles.map((file) => checkForeach(file, "php"));

printReport(pages.length, components.length, jsFiles.length + phpFiles.length);
process.exit(report.errors.length === 0 ? 0 : 1);
