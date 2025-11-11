// backend/routes/voyages.js
const express = require("express");
const router = express.Router();
const { sequelize } = require("../db");
const { QueryTypes } = require("sequelize");

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

    if (nom) { clauses.push(`nom = ?`);   params.push(String(nom).toUpperCase()); }
    if (annee) { clauses.push(`annee = ?`); params.push(Number(annee)); }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const rows = await sequelize.query(
      `SELECT id, nom, annee, offres, created_at, updated_at
         FROM voyages
         ${where}
       ORDER BY annee DESC, nom ASC`,
      { replacements: params, type: QueryTypes.SELECT }
    );

    res.json({ items: rows.map(normalize) });
  } catch (e) { next(e); }
});

// GET /api/voyages/:id
router.get("/:id", async (req, res, next) => {
  try {
    const rows = await sequelize.query(
      `SELECT id, nom, annee, offres, created_at, updated_at
         FROM voyages
        WHERE id = ?`,
      { replacements: [Number(req.params.id)], type: QueryTypes.SELECT }
    );
    if (rows.length === 0) return res.status(404).json({ message: "Voyage introuvable" });
    res.json(normalize(rows[0]));
  } catch (e) { next(e); }
});

// POST /api/voyages
router.post("/", async (req, res, next) => {
  try {
    const nom = String(req.body?.nom || "").toUpperCase().trim();
    const annee = Number(req.body?.annee);
    const offres = (req.body?.offres ?? "").toString().trim(); // optionnel

    if (!["HAJJ", "OUMRAH"].includes(nom)) {
      return res.status(400).json({ message: "nom doit être 'HAJJ' ou 'OUMRAH'" });
    }
    if (!Number.isFinite(annee) || annee < 2000 || annee > 2100) {
      return res.status(400).json({ message: "Année invalide" });
    }
    // (Option) limite simple sur la taille des offres
    if (offres.length > 5000) {
      return res.status(400).json({ message: "Le champ 'offres' est trop long (max 5000 caractères)." });
    }

    const dupe = await sequelize.query(
      `SELECT 1 FROM voyages WHERE nom = ? AND annee = ? LIMIT 1`,
      { replacements: [nom, annee], type: QueryTypes.SELECT }
    );
    if (dupe.length) {
      return res.status(409).json({ message: "Ce voyage existe déjà pour cette année." });
    }

    // MySQL: pas de RETURNING — INSERT puis SELECT
    const [insertId /*, metadata*/] = await sequelize.query(
      `INSERT INTO voyages (nom, annee, offres, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      { replacements: [nom, annee, offres || null], type: QueryTypes.INSERT }
    );

    const createdRows = await sequelize.query(
      `SELECT id, nom, annee, offres, created_at, updated_at
         FROM voyages
        WHERE id = ?`,
      { replacements: [insertId], type: QueryTypes.SELECT }
    );

    res.status(201).json(normalize(createdRows[0]));
  } catch (e) { next(e); }
});

// PUT /api/voyages/:id
router.put("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    const current = await sequelize.query(
      `SELECT id, nom, annee, offres FROM voyages WHERE id = ?`,
      { replacements: [id], type: QueryTypes.SELECT }
    );
    if (!current.length) return res.status(404).json({ message: "Voyage introuvable" });

    const nom = String(req.body?.nom ?? current[0].nom).toUpperCase().trim();
    const annee = Number(req.body?.annee ?? current[0].annee);
    const offres = (req.body?.offres ?? current[0].offres ?? "").toString().trim();

    if (!["HAJJ", "OUMRAH"].includes(nom)) {
      return res.status(400).json({ message: "nom doit être 'HAJJ' ou 'OUMRAH'" });
    }
    if (!Number.isFinite(annee) || annee < 2000 || annee > 2100) {
      return res.status(400).json({ message: "Année invalide" });
    }
    if (offres.length > 5000) {
      return res.status(400).json({ message: "Le champ 'offres' est trop long (max 5000 caractères)." });
    }

    if (nom !== current[0].nom || annee !== current[0].annee) {
      const dupe = await sequelize.query(
        `SELECT 1 FROM voyages WHERE nom = ? AND annee = ? AND id <> ? LIMIT 1`,
        { replacements: [nom, annee, id], type: QueryTypes.SELECT }
      );
      if (dupe.length) {
        return res.status(409).json({ message: "Un voyage identique existe déjà." });
      }
    }

    await sequelize.query(
      `UPDATE voyages
          SET nom = ?, annee = ?, offres = ?, updated_at = NOW()
        WHERE id = ?`,
      { replacements: [nom, annee, offres || null, id], type: QueryTypes.UPDATE }
    );

    const rows = await sequelize.query(
      `SELECT id, nom, annee, offres, created_at, updated_at
         FROM voyages
        WHERE id = ?`,
      { replacements: [id], type: QueryTypes.SELECT }
    );

    res.json(normalize(rows[0]));
  } catch (e) { next(e); }
});

// DELETE /api/voyages/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ message: "ID invalide" });
    }

    // 1) Existence d'abord
    const exists = await sequelize.query(
      `SELECT id FROM voyages WHERE id = ?`,
      { replacements: [id], type: QueryTypes.SELECT }
    );
    if (!exists.length) {
      return res.status(404).json({ message: "Voyage introuvable" });
    }

    // 2) Delete + check affectedRows (MySQL)
    const result = await sequelize.query(
      `DELETE FROM voyages WHERE id = ?`,
      { replacements: [id], type: QueryTypes.DELETE }
    );

    // Selon la version de Sequelize / MySQL, 'result' peut être:
    // - un nombre (affected rows)
    // - [ { affectedRows }, ... ]
    let affected = 0;
    if (Array.isArray(result)) {
      // mysql2 renvoie [result, meta], où result.affectedRows existe souvent
      const maybeObj = result[0];
      affected = typeof maybeObj === "object" && maybeObj
        ? (maybeObj.affectedRows ?? maybeObj.affected_rows ?? 0)
        : (Number(maybeObj) || 0);
    } else {
      affected = Number(result) || 0;
    }

    if (affected === 0) {
      // quelque chose a empêché la suppression
      return res.status(409).json({ message: "Suppression non effectuée" });
    }

    return res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
