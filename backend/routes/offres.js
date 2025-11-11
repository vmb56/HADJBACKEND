// backend/routes/offres.js
const express = require("express");
const router = express.Router();

// Instance sequelize (comme dans routes/vols.js)
const { sequelize } = require("../db");

/* =============== Helpers (alignés sur vols.js) =============== */
function isPg() {
  return (sequelize.getDialect?.() || "").toLowerCase() === "postgres";
}
const Q = (c) => (isPg() ? `"${c}"` : c); // quote identifiants Postgres

function logError(where, e) {
  // eslint-disable-next-line no-console
  console.error(`[offres] ${where}:`, e && (e.stack || e.message || e));
  if (e?.parent?.sql) console.error("[SQL]", e.parent.sql);
  if (e?.parent?.parameters) console.error("[Params]", e.parent.parameters);
}

// Colonnes sélectionnées avec alias camelCase stables pour le front
// NOTE: on lit en base snake_case (date_depart, date_arrivee, created_at, updated_at)
const offreCols = [
  `${Q("id")} AS "id"`,
  `${Q("nom")} AS "nom"`,
  `${Q("prix")} AS "prix"`,
  `${Q("hotel")} AS "hotel"`,
  `${Q("date_depart")} AS "dateDepart"`,
  `${Q("date_arrivee")} AS "dateArrivee"`,
  `${Q("created_at")} AS "createdAt"`,
  `${Q("updated_at")} AS "updatedAt"`,
].join(", ");

/* ===================== GET /api/offres ===================== */
router.get("/", async (req, res) => {
  try {
    const searchRaw = String(req.query.search || "").trim();
    let sql = `SELECT ${offreCols} FROM ${Q("offres")}`;
    const where = [];
    const params = {};

    if (searchRaw) {
      if (isPg()) {
        where.push(`(${Q("nom")} ILIKE :q OR ${Q("hotel")} ILIKE :q)`);
        params.q = `%${searchRaw}%`;
      } else {
        where.push(`(${Q("nom")} LIKE :q OR ${Q("hotel")} LIKE :q)`);
        params.q = `%${searchRaw}%`;
      }
    }

    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += ` ORDER BY ${Q("created_at")} DESC, ${Q("id")} DESC`;

    const [rows] = await sequelize.query(sql, { replacements: params });
    res.json({ items: rows || [] });
  } catch (e) {
    logError("GET /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ===================== POST /api/offres ===================== */
router.post("/", async (req, res) => {
  try {
    const { nom, prix, hotel, date_depart, date_arrivee } = req.body || {};
    if (!nom || !prix || !hotel || !date_depart || !date_arrivee) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }

    const payload = {
      nom: String(nom).trim(),
      prix: Number(prix),
      hotel: String(hotel).trim(),
      date_depart,   // 'YYYY-MM-DD'
      date_arrivee,  // 'YYYY-MM-DD'
    };

    let insertedId;
    if (isPg()) {
      const [rows] = await sequelize.query(
        `INSERT INTO ${Q("offres")} (${Q("nom")}, ${Q("prix")}, ${Q("hotel")}, ${Q("date_depart")}, ${Q("date_arrivee")}, ${Q("created_at")}, ${Q("updated_at")})
         VALUES (:nom, :prix, :hotel, :date_depart, :date_arrivee, NOW(), NOW())
         RETURNING ${Q("id")} AS "id"`,
        { replacements: payload }
      );
      insertedId = rows?.[0]?.id;
    } else {
      const [result] = await sequelize.query(
        `INSERT INTO ${Q("offres")} (${Q("nom")}, ${Q("prix")}, ${Q("hotel")}, ${Q("date_depart")}, ${Q("date_arrivee")}, ${Q("created_at")}, ${Q("updated_at")})
         VALUES (:nom, :prix, :hotel, :date_depart, :date_arrivee, NOW(), NOW())`,
        { replacements: payload }
      );
      insertedId = result?.insertId;
      if (!insertedId) {
        const [r] = await sequelize.query(`SELECT LAST_INSERT_ID() AS id`);
        insertedId = r?.[0]?.id;
      }
    }

    const [rowsSel] = await sequelize.query(
      `SELECT ${offreCols} FROM ${Q("offres")} WHERE ${Q("id")} = :id`,
      { replacements: { id: insertedId } }
    );

    res.status(201).json(rowsSel?.[0] || null);
  } catch (e) {
    logError("POST /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ===================== PUT /api/offres/:id ===================== */
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID invalide" });

    const { nom, prix, hotel, date_depart, date_arrivee } = req.body || {};
    if (!nom || !prix || !hotel || !date_depart || !date_arrivee) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }

    // Vérifier l'existence
    const [exists] = await sequelize.query(
      `SELECT ${Q("id")} AS "id" FROM ${Q("offres")} WHERE ${Q("id")} = :id`,
      { replacements: { id } }
    );
    if (!exists?.[0]) return res.status(404).json({ message: "Offre introuvable" });

    const replacements = {
      id,
      nom: String(nom).trim(),
      prix: Number(prix),
      hotel: String(hotel).trim(),
      date_depart,
      date_arrivee,
    };

    const updateSql = `
      UPDATE ${Q("offres")}
      SET
        ${Q("nom")}=:nom,
        ${Q("prix")}=:prix,
        ${Q("hotel")}=:hotel,
        ${Q("date_depart")}=:date_depart,
        ${Q("date_arrivee")}=:date_arrivee,
        ${Q("updated_at")}=NOW()
      WHERE ${Q("id")}=:id
    `;
    await sequelize.query(updateSql, { replacements });

    const [rowsSel] = await sequelize.query(
      `SELECT ${offreCols} FROM ${Q("offres")} WHERE ${Q("id")} = :id`,
      { replacements: { id } }
    );

    const updated = rowsSel?.[0];
    if (!updated) return res.status(404).json({ message: "Offre introuvable après MAJ" });

    res.json(updated);
  } catch (e) {
    logError("PUT /:id", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* =================== DELETE /api/offres/:id =================== */
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "ID invalide" });

    await sequelize.query(
      `DELETE FROM ${Q("offres")} WHERE ${Q("id")} = :id`,
      { replacements: { id } }
    );
    res.json({ ok: true });
  } catch (e) {
    logError("DELETE /:id", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
