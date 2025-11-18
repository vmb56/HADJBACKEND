// backend/routes/pelerinspaiement.js
const express = require("express");
const { query } = require("../db");

const router = express.Router();

// Construit URL publique pour les images si on reçoit un chemin relatif
function toPublicUrl(baseUrl, v) {
  if (!v) return null;
  const s = String(v);
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) return `${baseUrl}${s}`;
  return `${baseUrl}/${s}`;
}

/** Normalise un pèlerin (quel que soit snake/camel) */
function normPelerin(row = {}, baseUrl = "") {
  const passeport =
    row.passeport ??
    row.num_passeport ??
    row.NUM_PASSEPORT ??
    "";

  const photoPelerin =
    row.photoPelerin ??
    row.photo_pelerin ??
    row.photo_pelerin_path ??
    null;

  const photoPasseport =
    row.photoPasseport ??
    row.photo_passeport ??
    row.photo_passeport_path ??
    null;

  return {
    id: row.id,
    nom: row.nom,
    prenoms: row.prenoms,
    passeport,
    offre: row.offre ?? null,
    prixOffre: Number(row.prix_offre ?? row.prixOffre ?? 0), // 0 si pas en DB
    photoPelerin: toPublicUrl(baseUrl, photoPelerin),
    photoPasseport: toPublicUrl(baseUrl, photoPasseport),
    contact: row.contact ?? null,
  };
}

/** Normalise un paiement */
function normPayment(r = {}) {
  return {
    id: r.id,
    ref: r.ref,
    passeport: r.passeport,
    nom: r.nom,
    prenoms: r.prenoms,
    mode: r.mode,
    montant: Number(r.montant ?? r.montant_paye ?? 0),
    totalDu: Number(r.totalDu ?? r.total_du ?? 0),
    reduction: Number(r.reduction ?? 0),
    date: r.date ?? r.date_paiement ?? null,
    statut: r.statut,
  };
}

/**
 * GET /api/pelerinspaiement
 * Query:
 *   - search (facultatif): filtre sur nom/prenoms/num_passeport/contact/created_by_name
 *   - offre  (facultatif): filtre strict côté SQL si fourni (et pas 'TOUTES')
 *   - limit  (facultatif): limite nb pelerins (def 300, max 1000)
 *
 * Retour:
 *   { pelerins: [...], payments: [...] }
 */
router.get("/", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const offre = String(req.query.offre || "").trim();
    let limit = Number(req.query.limit || 300);
    if (!Number.isFinite(limit) || limit <= 0) limit = 300;
    if (limit > 1000) limit = 1000;

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    // Étape 1 : Pèlerins
    const whereParts = [];
    const params = [];

    if (search) {
      whereParts.push(
        [
          "nom LIKE ?",
          "prenoms LIKE ?",
          "num_passeport LIKE ?",
          "contact LIKE ?",
          "created_by_name LIKE ?",
        ].join(" OR ")
      );
      const p = `%${search}%`;
      params.push(p, p, p, p, p);
    }

    if (offre && offre.toUpperCase() !== "TOUTES") {
      whereParts.push("offre = ?");
      params.push(offre);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const pelerinsRes = await query(
      `
      SELECT
        id,
        photo_pelerin_path, photo_passeport_path,
        nom, prenoms, date_naissance, lieu_naissance, sexe,
        adresse, contact, num_passeport,
        offre, voyage, annee_voyage,
        created_by_name, created_by_id
      FROM pelerins
      ${whereSql}
      ORDER BY id DESC
      LIMIT ${limit}
      `,
      params
    );

    const pelerins = (pelerinsRes.rows || []).map((r) =>
      normPelerin(r, baseUrl)
    );

    if (!pelerins.length) {
      return res.json({ pelerins: [], payments: [] });
    }

    // Étape 2 : Payments des passeports trouvés
    const passports = pelerins
      .map((p) => p.passeport)
      .filter(Boolean);

    const placeholders = passports.map(() => "?").join(",");
    const paymentsRes = await query(
      `
      SELECT
        id, ref, passeport, nom, prenoms, mode, montant, totalDu, reduction, date, statut
      FROM payments
      WHERE passeport IN (${placeholders})
      ORDER BY id DESC
      `,
      passports
    );

    const payments = (paymentsRes.rows || []).map(normPayment);

    return res.json({ pelerins, payments });
  } catch (err) {
    console.error("❌ GET /api/pelerinspaiement:", err);
    res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

/**
 * GET /api/pelerinspaiement/by-passport?passport=XXXXXXX
 * Retour:
 *   { pelerin: {...} | null, payments: [...] }
 */
router.get("/by-passport", async (req, res) => {
  try {
    const passport = String(req.query.passport || "").trim();
    if (!passport) {
      return res
        .status(400)
        .json({ message: "Paramètre 'passport' requis." });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const pelerinsRes = await query(
      `
      SELECT
        id,
        photo_pelerin_path, photo_passeport_path,
        nom, prenoms, date_naissance, lieu_naissance, sexe,
        adresse, contact, num_passeport,
        offre, voyage, annee_voyage,
        created_by_name, created_by_id
      FROM pelerins
      WHERE num_passeport = ?
      LIMIT 1
      `,
      [passport]
    );

    const row = pelerinsRes.rows?.[0];
    const pelerin = row ? normPelerin(row, baseUrl) : null;

    const paymentsRes = await query(
      `
      SELECT
        id, ref, passeport, nom, prenoms, mode, montant, totalDu, reduction, date, statut
      FROM payments
      WHERE passeport = ?
      ORDER BY id DESC
      `,
      [passport]
    );

    const payments = (paymentsRes.rows || []).map(normPayment);

    res.json({ pelerin, payments });
  } catch (err) {
    console.error("❌ GET /api/pelerinspaiement/by-passport:", err);
    res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

module.exports = router;
