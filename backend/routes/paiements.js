// backend/routes/paiements.js
const express = require("express");
const router = express.Router();
const { query } = require("../db"); // ⬅️ Turso / libSQL

/* ======================== CONFIG NOMS DE TABLES ============================ */
const T_PAY = "payments";     // table des paiements
const T_VERSE = "versements"; // table des échéanciers / versements

/* ============================= Helpers ==================================== */

function logErr(where, e) {
  console.error(`[paiements] ${where}:`, e?.stack || e?.message || e);
}

function genRef() {
  const d = new Date();
  const y = d.getFullYear();
  const n = Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, "0");
  return `PAY-${y}-${n}`;
}

/* Colonnes retournées pour le front (camelCase déjà en base) */
const PAY_SELECT = `
  id,
  ref,
  passeport,
  nom,
  prenoms,
  mode,
  montant,
  totalDu,
  reduction,
  date,
  statut,
  createdAt,
  updatedAt
`;

const VERSE_SELECT = `
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
`;

/* =========================== GET /api/paiements =========================== */
router.get("/", async (req, res) => {
  try {
    const passeport = String(req.query.passeport || "").trim();
    const du = String(req.query.du || "").trim(); // YYYY-MM-DD
    const au = String(req.query.au || "").trim(); // YYYY-MM-DD

    const where = [];
    const params = [];

    if (passeport) {
      where.push("passeport = ?");
      params.push(passeport);
    }
    if (du) {
      where.push("date >= ?");
      params.push(du);
    }
    if (au) {
      where.push("date <= ?");
      params.push(au);
    }

    let sql = `SELECT ${PAY_SELECT} FROM ${T_PAY}`;
    if (where.length) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }
    sql += " ORDER BY createdAt DESC";

    if (!where.length) {
      sql += " LIMIT 1000";
    }

    const result = await query(sql, params);
    res.json({ items: result.rows || [] });
  } catch (e) {
    logErr("GET /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* =========================== POST /api/paiements ========================== */
router.post("/", async (req, res) => {
  try {
    const b = req.body || {};
    const dateISO =
      String(b.date || "").trim() ||
      new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    if (!b.passeport || !b.nom) {
      return res
        .status(400)
        .json({ message: "Champs requis manquants (passeport, nom)." });
    }

    const ref = genRef();
    const passeport = String(b.passeport).trim();
    const nom = String(b.nom).trim();
    const prenoms = String(b.prenoms || "").trim();
    const mode = String(b.mode || "Espèces").trim();
    const montant = Number(b.montant || 0);
    const totalDu = Number(b.totalDu || 0);
    const reduction = Number(b.reduction || 0);
    const date = dateISO;
    const statut = String(b.statut || "Partiel").trim();

    const insertRes = await query(
      `
      INSERT INTO ${T_PAY} (
        ref, passeport, nom, prenoms, mode,
        montant, totalDu, reduction, date, statut,
        createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING ${PAY_SELECT}
      `,
      [
        ref,
        passeport,
        nom,
        prenoms,
        mode,
        montant,
        totalDu,
        reduction,
        date,
        statut,
      ]
    );

    const row = insertRes.rows?.[0] || null;
    res.status(201).json(row);
  } catch (e) {
    logErr("POST /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ======================= GET /api/paiements/versements ==================== */
router.get("/versements", async (req, res) => {
  try {
    const passeport = String(req.query.passeport || "").trim();

    let sql = `SELECT ${VERSE_SELECT} FROM ${T_VERSE}`;
    const params = [];

    if (passeport) {
      sql += " WHERE passeport = ?";
      params.push(passeport);
    }

    sql += " ORDER BY createdAt DESC";

    if (!passeport) {
      sql += " LIMIT 1000";
    }

    const result = await query(sql, params);
    res.json({ items: result.rows || [] });
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
      return res
        .status(400)
        .json({ message: "Champs requis manquants (passeport, nom)." });
    }

    const passeport = String(b.passeport).trim();
    const nom = String(b.nom).trim();
    const prenoms = String(b.prenoms || "").trim();
    const echeance =
      String(b.echeance || "").trim() ||
      new Date().toISOString().slice(0, 10);
    const verse = Number(b.verse || 0);
    const restant = Number(b.restant || 0);
    const statut = String(b.statut || "En cours").trim();

    const insertRes = await query(
      `
      INSERT INTO ${T_VERSE} (
        passeport, nom, prenoms, echeance,
        verse, restant, statut,
        createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING ${VERSE_SELECT}
      `,
      [passeport, nom, prenoms, echeance, verse, restant, statut]
    );

    const row = insertRes.rows?.[0] || null;
    res.status(201).json(row);
  } catch (e) {
    logErr("POST /versements", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
