// backend/routes/versements.js
const express = require("express");
const router = express.Router();
const { sequelize } = require("../db");

/* ---------------------------------------------
   Helpers MySQL
---------------------------------------------- */
const Q = (c) => `\`${c}\``;

/** Normalise un enregistrement DB -> objet attendu par le front */
function normVersement(r = {}) {
  return {
    id: r.id,
    passeport: r.passeport,
    nom: r.nom,
    prenoms: r.prenoms,
    // s'assurer du format YYYY-MM-DD côté front
    echeance: (r.echeance || r.ECHEANCE || null)?.toString?.().slice(0, 10) || r.echeance || null,
    verse: Number(r.verse ?? 0),
    restant: Number(r.restant ?? 0),
    statut: r.statut || null,
    // ces champs sont optionnels/absents dans ta table, on les laisse à null
    createdAt: null,
    updatedAt: null,
  };
}

/* ==========================================================
   GET /api/versements
   Query params:
     - passeport: filtre exact
     - du, au   : bornes inclusives sur la date d’échéance (YYYY-MM-DD)
     - limit    : nombre max (défaut 1000, max 5000)
   Retour: { items: [...] }
========================================================== */
router.get("/", async (req, res) => {
  try {
    const passeport = String(req.query.passeport || "").trim().toUpperCase();
    const du = String(req.query.du || "").trim();
    const au = String(req.query.au || "").trim();
    let limit = Number(req.query.limit || 1000);
    if (!Number.isFinite(limit) || limit <= 0) limit = 1000;
    if (limit > 5000) limit = 5000;

    const where = [];
    const params = [];

    if (passeport) {
      where.push(`${Q("passeport")} = ?`);
      params.push(passeport);
    }
    if (du) {
      where.push(`${Q("echeance")} >= ?`);
      params.push(du);
    }
    if (au) {
      where.push(`${Q("echeance")} <= ?`);
      params.push(au);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [rows] = await sequelize.query(
      `
      SELECT
        ${Q("id")},
        ${Q("passeport")},
        ${Q("nom")},
        ${Q("prenoms")},
        ${Q("echeance")},
        ${Q("verse")},
        ${Q("restant")},
        ${Q("statut")}
      FROM ${Q("versements")}
      ${whereSql}
      ORDER BY ${Q("id")} DESC
      LIMIT ${limit}
      `,
      { replacements: params }
    );

    const items = Array.isArray(rows) ? rows.map(normVersement) : [];
    return res.json({ items });
  } catch (e) {
    console.error("❌ GET /api/versements:", e);
    return res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ==========================================================
   POST /api/versements
   Body JSON:
     { passeport, nom, prenoms, echeance, verse, restant, statut }
   - Valide le minimum
   - Insère (sans created_at/updated_at)
   - Retourne l’enregistrement créé (normalisé)
========================================================== */
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    const payload = {
      passeport: String(b.passeport || "").trim().toUpperCase(),
      nom: String(b.nom || "").trim(),
      prenoms: String(b.prenoms || "").trim(),
      echeance: String(b.echeance || "").trim() || new Date().toISOString().slice(0, 10),
      verse: Number(b.verse || 0),
      restant: Number(b.restant || 0),
      statut: String(b.statut || "En cours").trim(),
    };

    if (!payload.passeport) {
      return res.status(400).json({ message: "Le champ 'passeport' est obligatoire." });
    }
    if (!payload.nom) {
      return res.status(400).json({ message: "Le champ 'nom' est obligatoire." });
    }
    if (!Number.isFinite(payload.verse) || payload.verse <= 0) {
      return res.status(400).json({ message: "Le champ 'verse' doit être un nombre > 0." });
    }
    if (!Number.isFinite(payload.restant) || payload.restant < 0) {
      return res.status(400).json({ message: "Le champ 'restant' doit être un nombre ≥ 0." });
    }

    // Insertion sans created_at/updated_at
    const [result] = await sequelize.query(
      `
      INSERT INTO ${Q("versements")}
        (${Q("passeport")}, ${Q("nom")}, ${Q("prenoms")},
         ${Q("echeance")}, ${Q("verse")}, ${Q("restant")}, ${Q("statut")})
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      {
        replacements: [
          payload.passeport,
          payload.nom,
          payload.prenoms,
          payload.echeance,
          payload.verse,
          payload.restant,
          payload.statut,
        ],
      }
    );

    const insertedId = result?.insertId;
    if (!insertedId) {
      return res.status(500).json({ message: "Insertion échouée." });
    }

    // Lecture & renvoi
    const [[row]] = await sequelize.query(
      `
      SELECT
        ${Q("id")},
        ${Q("passeport")},
        ${Q("nom")},
        ${Q("prenoms")},
        ${Q("echeance")},
        ${Q("verse")},
        ${Q("restant")},
        ${Q("statut")}
      FROM ${Q("versements")}
      WHERE ${Q("id")} = ?
      `,
      { replacements: [insertedId] }
    );

    return res.status(201).json(normVersement(row));
  } catch (e) {
    console.error("❌ POST /api/versements:", e);
    return res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
