// backend/routes/versements.js
const express = require("express");
const router = express.Router();
const { query } = require("../db");

/** Normalise un enregistrement DB -> objet attendu par le front */
function normVersement(r = {}) {
  const echeance =
    (r.echeance || r.ECHEANCE || null)?.toString?.().slice(0, 10) ||
    r.echeance ||
    null;

  return {
    id: r.id,
    passeport: r.passeport,
    nom: r.nom,
    prenoms: r.prenoms,
    echeance,
    verse: Number(r.verse ?? 0),
    restant: Number(r.restant ?? 0),
    statut: r.statut || null,
    createdAt: r.createdAt ?? r.created_at ?? null,
    updatedAt: r.updatedAt ?? r.updated_at ?? null,
  };
}

/* ==========================================================
   GET /api/versements
   Query:
     - passeport: filtre exact
     - du, au   : bornes sur l’échéance (YYYY-MM-DD)
     - limit    : défaut 1000, max 5000
   Retour: { items: [...] }
========================================================== */
router.get("/", async (req, res) => {
  try {
    const passeport = String(req.query.passeport || "")
      .trim()
      .toUpperCase();
    const du = String(req.query.du || "").trim();
    const au = String(req.query.au || "").trim();
    let limit = Number(req.query.limit || 1000);
    if (!Number.isFinite(limit) || limit <= 0) limit = 1000;
    if (limit > 5000) limit = 5000;

    const where = [];
    const params = [];

    if (passeport) {
      where.push("passeport = ?");
      params.push(passeport);
    }
    if (du) {
      where.push("echeance >= ?");
      params.push(du);
    }
    if (au) {
      where.push("echeance <= ?");
      params.push(au);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const result = await query(
      `
      SELECT
        id,
        passeport,
        nom,
        prenoms,
        echeance,
        verse,
        restant,
        statut,
        createdAt,
        updatedAt
      FROM versements
      ${whereSql}
      ORDER BY id DESC
      LIMIT ${limit}
      `,
      params
    );

    const items = (result.rows || []).map(normVersement);
    return res.json({ items });
  } catch (e) {
    console.error("❌ GET /api/versements:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ==========================================================
   POST /api/versements
   Body JSON:
     { passeport, nom, prenoms, echeance, verse, restant, statut }
========================================================== */
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    const payload = {
      passeport: String(b.passeport || "").trim().toUpperCase(),
      nom: String(b.nom || "").trim(),
      prenoms: String(b.prenoms || "").trim(),
      echeance:
        String(b.echeance || "").trim() ||
        new Date().toISOString().slice(0, 10),
      verse: Number(b.verse || 0),
      restant: Number(b.restant || 0),
      statut: String(b.statut || "En cours").trim(),
    };

    if (!payload.passeport) {
      return res
        .status(400)
        .json({ message: "Le champ 'passeport' est obligatoire." });
    }
    if (!payload.nom) {
      return res
        .status(400)
        .json({ message: "Le champ 'nom' est obligatoire." });
    }
    if (!Number.isFinite(payload.verse) || payload.verse <= 0) {
      return res.status(400).json({
        message: "Le champ 'verse' doit être un nombre > 0.",
      });
    }
    if (!Number.isFinite(payload.restant) || payload.restant < 0) {
      return res.status(400).json({
        message: "Le champ 'restant' doit être un nombre ≥ 0.",
      });
    }

    const insertRes = await query(
      `
      INSERT INTO versements (
        passeport,
        nom,
        prenoms,
        echeance,
        verse,
        restant,
        statut,
        createdAt,
        updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING
        id,
        passeport,
        nom,
        prenoms,
        echeance,
        verse,
        restant,
        statut,
        createdAt,
        updatedAt
      `,
      [
        payload.passeport,
        payload.nom,
        payload.prenoms,
        payload.echeance,
        payload.verse,
        payload.restant,
        payload.statut,
      ]
    );

    const row = insertRes.rows?.[0];
    if (!row) {
      return res
        .status(500)
        .json({ message: "Insertion échouée." });
    }

    return res.status(201).json(normVersement(row));
  } catch (e) {
    console.error("❌ POST /api/versements:", e);
    return res
      .status(500)
      .json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
