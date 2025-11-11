// backend/routes/paiements.js
const express = require("express");
const router = express.Router();
const { sequelize } = require("../db");

/* ======================== CONFIG NOMS DE TABLES ============================
   Si tes tables s'appellent "paiements" et "versements", adapte ici.
   ========================================================================== */
const T_PAY = "payments";     // mets "paiements" si c'est ton nom de table
const T_VERSE = "versements"; // adapté si besoin

/* ========================== Dialect & helpers ============================ */
function isPg() {
  return (sequelize.getDialect?.() || "").toLowerCase() === "postgres";
}
const Q = (c) => (isPg() ? `"${c}"` : `\`${c}\``);
const NOW = () => (isPg() ? "NOW()" : "NOW()");

function logErr(where, e) {
  // eslint-disable-next-line no-console
  console.error(`[paiements] ${where}:`, e?.stack || e?.message || e);
  if (e?.parent?.sql) console.error("[SQL]", e.parent.sql);
  if (e?.parent?.parameters) console.error("[Params]", e.parent.parameters);
}

/* ================== Map colonnes réelles <-> alias API ===================
   On suppose DB en snake_case. Mettre USE_SNAKE_CASE=false si ta DB est camel.
   ========================================================================== */
// juste en haut, là où on l’a défini
const USE_SNAKE_CASE = false;   // ← passe à false


const COLS = USE_SNAKE_CASE
  ? {
      id:        `${Q("id")} AS "id"`,
      ref:       `${Q("ref")} AS "ref"`,
      passeport: `${Q("passeport")} AS "passeport"`,
      nom:       `${Q("nom")} AS "nom"`,
      prenoms:   `${Q("prenoms")} AS "prenoms"`,
      mode:      `${Q("mode")} AS "mode"`,
      montant:   `${Q("montant")} AS "montant"`,
      totalDu:   `${Q("total_du")} AS "totalDu"`,
      reduction: `${Q("reduction")} AS "reduction"`,
      date:      `${Q("date")} AS "date"`,
      statut:    `${Q("statut")} AS "statut"`,
      createdAt: `${Q("created_at")} AS "createdAt"`,
      updatedAt: `${Q("updated_at")} AS "updatedAt"`,
    }
  : {
      id:        `${Q("id")} AS "id"`,
      ref:       `${Q("ref")} AS "ref"`,
      passeport: `${Q("passeport")} AS "passeport"`,
      nom:       `${Q("nom")} AS "nom"`,
      prenoms:   `${Q("prenoms")} AS "prenoms"`,
      mode:      `${Q("mode")} AS "mode"`,
      montant:   `${Q("montant")} AS "montant"`,
      totalDu:   `${Q("totalDu")} AS "totalDu"`,
      reduction: `${Q("reduction")} AS "reduction"`,
      date:      `${Q("date")} AS "date"`,
      statut:    `${Q("statut")} AS "statut"`,
      createdAt: `${Q("createdAt")} AS "createdAt"`,
      updatedAt: `${Q("updatedAt")} AS "updatedAt"`,
    };

const PAY_SELECT = Object.values(COLS).join(", ");

const VERSE_COLS = USE_SNAKE_CASE
  ? {
      id:        `${Q("id")} AS "id"`,
      passeport: `${Q("passeport")} AS "passeport"`,
      nom:       `${Q("nom")} AS "nom"`,
      prenoms:   `${Q("prenoms")} AS "prenoms"`,
      echeance:  `${Q("echeance")} AS "echeance"`,
      verse:     `${Q("verse")} AS "verse"`,
      restant:   `${Q("restant")} AS "restant"`,
      statut:    `${Q("statut")} AS "statut"`,
      createdAt: `${Q("created_at")} AS "createdAt"`,
      updatedAt: `${Q("updated_at")} AS "updatedAt"`,
    }
  : {
      id:        `${Q("id")} AS "id"`,
      passeport: `${Q("passeport")} AS "passeport"`,
      nom:       `${Q("nom")} AS "nom"`,
      prenoms:   `${Q("prenoms")} AS "prenoms"`,
      echeance:  `${Q("echeance")} AS "echeance"`,
      verse:     `${Q("verse")} AS "verse"`,
      restant:   `${Q("restant")} AS "restant"`,
      statut:    `${Q("statut")} AS "statut"`,
      createdAt: `${Q("createdAt")} AS "createdAt"`,
      updatedAt: `${Q("updatedAt")} AS "updatedAt"`,
    };

const VERSE_SELECT = Object.values(VERSE_COLS).join(", ");

/* ============================ Générer une ref ============================ */
function genRef() {
  const d = new Date();
  const y = d.getFullYear();
  const n = Math.floor(Math.random() * 1e6).toString().padStart(6, "0");
  return `PAY-${y}-${n}`;
}

/* =========================== GET /api/paiements =========================== */
router.get("/", async (req, res) => {
  try {
    const passeport = String(req.query.passeport || "").trim();
    const du = String(req.query.du || "").trim(); // YYYY-MM-DD
    const au = String(req.query.au || "").trim(); // YYYY-MM-DD

    const where = [];
    const params = {};

    if (passeport) {
      where.push(`${Q("passeport")} = :p`);
      params.p = passeport;
    }
    if (du) {
      where.push(`${Q("date")} >= :du`);
      params.du = du;
    }
    if (au) {
      where.push(`${Q("date")} <= :au`);
      params.au = au;
    }

    let sql =
      `SELECT ${PAY_SELECT} FROM ${Q(T_PAY)}` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY ${USE_SNAKE_CASE ? Q("created_at") : Q("createdAt")} DESC` +
      (!where.length ? " LIMIT 1000" : "");

    const [rows] = await sequelize.query(sql, { replacements: params });
    res.json({ items: rows || [] });
  } catch (e) {
    logErr("GET /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* =========================== POST /api/paiements ========================== */
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    const dateISO = String(b.date || "").trim() || new Date().toISOString().slice(0, 10);

    if (!b.passeport || !b.nom) {
      return res.status(400).json({ message: "Champs requis manquants (passeport, nom)." });
    }

    const replacements = {
      ref: genRef(),
      passeport: String(b.passeport).trim(),
      nom: String(b.nom).trim(),
      prenoms: String(b.prenoms || "").trim(),
      mode: String(b.mode || "Espèces").trim(),
      montant: Number(b.montant || 0),
      totalDu: Number(b.totalDu || 0),
      reduction: Number(b.reduction || 0),
      date: dateISO,
      statut: String(b.statut || "Partiel").trim(),
    };

    const cols = USE_SNAKE_CASE
      ? { totalDu: "total_du", createdAt: "created_at", updatedAt: "updated_at" }
      : { totalDu: "totalDu", createdAt: "createdAt", updatedAt: "updatedAt" };

    let insertedId;

    if (isPg()) {
      // Postgres : RETURNING id
      const insertSqlPg = `
        INSERT INTO ${Q(T_PAY)}
          (${Q("ref")}, ${Q("passeport")}, ${Q("nom")}, ${Q("prenoms")}, ${Q("mode")},
           ${Q("montant")}, ${Q(cols.totalDu)}, ${Q("reduction")}, ${Q("date")}, ${Q("statut")},
           ${Q(cols.createdAt)}, ${Q(cols.updatedAt)})
        VALUES
          (:ref, :passeport, :nom, :prenoms, :mode,
           :montant, :totalDu, :reduction, :date, :statut,
           ${NOW()}, ${NOW()})
        RETURNING ${Q("id")} AS "id"
      `;
      const [rows] = await sequelize.query(insertSqlPg, { replacements });
      insertedId = rows?.[0]?.id;
    } else {
      // MySQL/MariaDB
      const insertSqlMy = `
        INSERT INTO ${Q(T_PAY)}
          (${Q("ref")}, ${Q("passeport")}, ${Q("nom")}, ${Q("prenoms")}, ${Q("mode")},
           ${Q("montant")}, ${Q(cols.totalDu)}, ${Q("reduction")}, ${Q("date")}, ${Q("statut")},
           ${Q(cols.createdAt)}, ${Q(cols.updatedAt)})
        VALUES
          (:ref, :passeport, :nom, :prenoms, :mode,
           :montant, :totalDu, :reduction, :date, :statut,
           ${NOW()}, ${NOW()})
      `;
      const [r] = await sequelize.query(insertSqlMy, { replacements });
      insertedId = r?.insertId;
      if (!insertedId) {
        const [[x]] = await sequelize.query("SELECT LAST_INSERT_ID() AS id");
        insertedId = x?.id;
      }
    }

    const [rowsSel] = await sequelize.query(
      `SELECT ${PAY_SELECT} FROM ${Q(T_PAY)} WHERE ${Q("id")} = :id`,
      { replacements: { id: insertedId } }
    );

    res.status(201).json(rowsSel?.[0] || null);
  } catch (e) {
    logErr("POST /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ======================= GET /api/paiements/versements ==================== */
router.get("/versements", async (req, res) => {
  try {
    const passeport = String(req.query.passeport || "").trim();
    let sql =
      `SELECT ${VERSE_SELECT} FROM ${Q(T_VERSE)}` +
      (passeport ? ` WHERE ${Q("passeport")} = :p` : "") +
      ` ORDER BY ${USE_SNAKE_CASE ? Q("created_at") : Q("createdAt")} DESC` +
      (passeport ? "" : " LIMIT 1000");

    const [rows] = await sequelize.query(sql, {
      replacements: passeport ? { p: passeport } : {},
    });
    res.json({ items: rows || [] });
  } catch (e) {
    logErr("GET /versements", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ======================= POST /api/paiements/versements =================== */
router.post("/versements", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.passeport || !b.nom) {
      return res.status(400).json({ message: "Champs requis manquants (passeport, nom)." });
    }

    const replacements = {
      passeport: String(b.passeport).trim(),
      nom: String(b.nom).trim(),
      prenoms: String(b.prenoms || "").trim(),
      echeance: String(b.echeance || "").trim() || new Date().toISOString().slice(0, 10),
      verse: Number(b.verse || 0),
      restant: Number(b.restant || 0),
      statut: String(b.statut || "En cours").trim(),
    };

    const cols = USE_SNAKE_CASE
      ? { createdAt: "created_at", updatedAt: "updated_at" }
      : { createdAt: "createdAt", updatedAt: "updatedAt" };

    let insertedId;

    if (isPg()) {
      const insertSqlPg = `
        INSERT INTO ${Q(T_VERSE)}
          (${Q("passeport")}, ${Q("nom")}, ${Q("prenoms")}, ${Q("echeance")},
           ${Q("verse")}, ${Q("restant")}, ${Q("statut")}, ${Q(cols.createdAt)}, ${Q(cols.updatedAt)})
        VALUES
          (:passeport, :nom, :prenoms, :echeance,
           :verse, :restant, :statut, ${NOW()}, ${NOW()})
        RETURNING ${Q("id")} AS "id"
      `;
      const [rows] = await sequelize.query(insertSqlPg, { replacements });
      insertedId = rows?.[0]?.id;
    } else {
      const insertSqlMy = `
        INSERT INTO ${Q(T_VERSE)}
          (${Q("passeport")}, ${Q("nom")}, ${Q("prenoms")}, ${Q("echeance")},
           ${Q("verse")}, ${Q("restant")}, ${Q("statut")}, ${Q(cols.createdAt)}, ${Q(cols.updatedAt)})
        VALUES
          (:passeport, :nom, :prenoms, :echeance,
           :verse, :restant, :statut, ${NOW()}, ${NOW()})
      `;
      const [r] = await sequelize.query(insertSqlMy, { replacements });
      insertedId = r?.insertId;
      if (!insertedId) {
        const [[x]] = await sequelize.query("SELECT LAST_INSERT_ID() AS id");
        insertedId = x?.id;
      }
    }

    const [rowsSel] = await sequelize.query(
      `SELECT ${VERSE_SELECT} FROM ${Q(T_VERSE)} WHERE ${Q("id")} = :id`,
      { replacements: { id: insertedId } }
    );
    res.status(201).json(rowsSel?.[0] || null);
  } catch (e) {
    logErr("POST /versements", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
