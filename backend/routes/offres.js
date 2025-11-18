// backend/routes/offres.js
const express = require("express");
const router = express.Router();

const { query } = require("../db"); // ⬅️ Turso / libSQL

function logError(where, e) {
  console.error(`[offres] ${where}:`, e && (e.stack || e.message || e));
}

/* Colonnes retournées pour le front, avec alias camelCase */
const OFFRE_COLS = `
  id        AS id,
  nom       AS nom,
  prix      AS prix,
  hotel     AS hotel,
  date_depart  AS dateDepart,
  date_arrivee AS dateArrivee,
  created_at   AS createdAt,
  updated_at   AS updatedAt
`;

/* ===================== GET /api/offres ===================== */
router.get("/", async (req, res) => {
  try {
    const searchRaw = String(req.query.search || "").trim();
    let sql = `SELECT ${OFFRE_COLS} FROM offres`;
    const where = [];
    const params = [];

    if (searchRaw) {
      where.push("(nom LIKE ? OR hotel LIKE ?)");
      const p = `%${searchRaw}%`;
      params.push(p, p);
    }

    if (where.length) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }
    sql += ` ORDER BY created_at DESC, id DESC`;

    const result = await query(sql, params);
    res.json({ items: result.rows || [] });
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

    const insertRes = await query(
      `
      INSERT INTO offres (nom, prix, hotel, date_depart, date_arrivee, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING ${OFFRE_COLS}
      `,
      [
        payload.nom,
        payload.prix,
        payload.hotel,
        payload.date_depart,
        payload.date_arrivee,
      ]
    );

    const row = insertRes.rows?.[0] || null;
    res.status(201).json(row);
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
    const existsRes = await query(
      "SELECT id FROM offres WHERE id = ? LIMIT 1",
      [id]
    );
    if (!existsRes.rows?.[0]) {
      return res.status(404).json({ message: "Offre introuvable" });
    }

    await query(
      `
      UPDATE offres
      SET
        nom = ?,
        prix = ?,
        hotel = ?,
        date_depart = ?,
        date_arrivee = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        String(nom).trim(),
        Number(prix),
        String(hotel).trim(),
        date_depart,
        date_arrivee,
        id,
      ]
    );

    const updatedRes = await query(
      `SELECT ${OFFRE_COLS} FROM offres WHERE id = ? LIMIT 1`,
      [id]
    );
    const updated = updatedRes.rows?.[0];

    if (!updated) {
      return res
        .status(404)
        .json({ message: "Offre introuvable après MAJ" });
    }

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

    await query("DELETE FROM offres WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (e) {
    logError("DELETE /:id", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
