// backend/routes/voyages.js
const express = require("express");
const router = express.Router();
const { query } = require("../db"); // ⬅️ Turso, plus de sequelize / QueryTypes

function normalize(r) {
  return {
    id: r.id,
    nom: r.nom,
    annee: r.annee,
    offres: r.offres ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// GET /api/voyages?nom=HAJJ&annee=2025
router.get("/", async (req, res, next) => {
  try {
    const { nom, annee } = req.query;
    const clauses = [];
    const params = [];

    if (nom) {
      clauses.push(`nom = ?`);
      params.push(String(nom).toUpperCase());
    }
    if (annee) {
      clauses.push(`annee = ?`);
      params.push(Number(annee));
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const result = await query(
      `
      SELECT id, nom, annee, offres, created_at, updated_at
      FROM voyages
      ${where}
      ORDER BY annee DESC, nom ASC
      `,
      params
    );

    res.json({ items: (result.rows || []).map(normalize) });
  } catch (e) {
    next(e);
  }
});

// GET /api/voyages/:id
router.get("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const result = await query(
      `
      SELECT id, nom, annee, offres, created_at, updated_at
      FROM voyages
      WHERE id = ?
      `,
      [id]
    );

    const rows = result.rows || [];
    if (!rows.length) {
      return res.status(404).json({ message: "Voyage introuvable" });
    }
    res.json(normalize(rows[0]));
  } catch (e) {
    next(e);
  }
});

// POST /api/voyages
router.post("/", async (req, res, next) => {
  try {
    const nom = String(req.body?.nom || "").toUpperCase().trim();
    const annee = Number(req.body?.annee);
    const offres = (req.body?.offres ?? "").toString().trim(); // optionnel

    if (!["HAJJ", "OUMRAH"].includes(nom)) {
      return res
        .status(400)
        .json({ message: "nom doit être 'HAJJ' ou 'OUMRAH'" });
    }
    if (!Number.isFinite(annee) || annee < 2000 || annee > 2100) {
      return res.status(400).json({ message: "Année invalide" });
    }
    if (offres.length > 5000) {
      return res.status(400).json({
        message:
          "Le champ 'offres' est trop long (max 5000 caractères).",
      });
    }

    // doublon nom+annee ?
    const dupeRes = await query(
      `SELECT 1 AS x FROM voyages WHERE nom = ? AND annee = ? LIMIT 1`,
      [nom, annee]
    );
    if (dupeRes.rows?.length) {
      return res
        .status(409)
        .json({ message: "Ce voyage existe déjà pour cette année." });
    }

    // Turso : INSERT ... RETURNING
    const insertRes = await query(
      `
      INSERT INTO voyages (nom, annee, offres, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, nom, annee, offres, created_at, updated_at
      `,
      [nom, annee, offres || null]
    );

    const created = insertRes.rows?.[0];
    if (!created) {
      return res
        .status(500)
        .json({ message: "Insertion échouée." });
    }

    res.status(201).json(normalize(created));
  } catch (e) {
    next(e);
  }
});

// PUT /api/voyages/:id
router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const currentRes = await query(
      `SELECT id, nom, annee, offres FROM voyages WHERE id = ?`,
      [id]
    );
    const current = currentRes.rows || [];
    if (!current.length) {
      return res.status(404).json({ message: "Voyage introuvable" });
    }

    const cur = current[0];

    const nom = String(req.body?.nom ?? cur.nom)
      .toUpperCase()
      .trim();
    const annee = Number(req.body?.annee ?? cur.annee);
    const offres = (
      req.body?.offres ?? cur.offres ?? ""
    ).toString().trim();

    if (!["HAJJ", "OUMRAH"].includes(nom)) {
      return res
        .status(400)
        .json({ message: "nom doit être 'HAJJ' ou 'OUMRAH'" });
    }
    if (!Number.isFinite(annee) || annee < 2000 || annee > 2100) {
      return res.status(400).json({ message: "Année invalide" });
    }
    if (offres.length > 5000) {
      return res.status(400).json({
        message:
          "Le champ 'offres' est trop long (max 5000 caractères).",
      });
    }

    // contrôle duplicat si nom ou année changent
    if (nom !== cur.nom || annee !== cur.annee) {
      const dupeRes = await query(
        `
        SELECT 1 AS x
        FROM voyages
        WHERE nom = ? AND annee = ? AND id <> ?
        LIMIT 1
        `,
        [nom, annee, id]
      );
      if (dupeRes.rows?.length) {
        return res
          .status(409)
          .json({ message: "Un voyage identique existe déjà." });
      }
    }

    await query(
      `
      UPDATE voyages
      SET nom = ?, annee = ?, offres = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [nom, annee, offres || null, id]
    );

    const rowsRes = await query(
      `
      SELECT id, nom, annee, offres, created_at, updated_at
      FROM voyages
      WHERE id = ?
      `,
      [id]
    );

    const rows = rowsRes.rows || [];
    if (!rows.length) {
      return res
        .status(404)
        .json({ message: "Voyage introuvable après MAJ" });
    }

    res.json(normalize(rows[0]));
  } catch (e) {
    next(e);
  }
});

// DELETE /api/voyages/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "ID invalide" });
    }

    const existsRes = await query(
      `SELECT id FROM voyages WHERE id = ?`,
      [id]
    );
    if (!existsRes.rows?.length) {
      return res.status(404).json({ message: "Voyage introuvable" });
    }

    await query(`DELETE FROM voyages WHERE id = ?`, [id]);

    return res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
