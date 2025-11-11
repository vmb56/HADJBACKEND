// backend/routes/pelerinspaiement.js
const express = require("express");
const path = require("path");
const { sequelize } = require("../db");

const router = express.Router();

// Helper MySQL quoting
const Q = (c) => `\`${c}\``;

// Construit URL publique pour les images si on reçoit un chemin relatif
function toPublicUrl(baseUrl, v) {
  if (!v) return null;
  if (String(v).startsWith("http://") || String(v).startsWith("https://")) return v;
  if (String(v).startsWith("/")) return `${baseUrl}${v}`;
  return `${baseUrl}/${v}`;
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

  // ⚠️ On n’utilise pas prix_offre ici pour éviter d’exploser si la colonne n’existe pas chez toi.
  // Si plus tard tu ajoutes une colonne `prix_offre`, tu pourras l’inclure dans le SELECT
  // et la mapper ici: const prixOffre = Number(row.prix_offre ?? 0);

  return {
    id: row.id,
    nom: row.nom,
    prenoms: row.prenoms,
    passeport,
    offre: row.offre ?? null,
    prixOffre: Number(row.prix_offre ?? row.prixOffre ?? 0), // restera 0 si pas en DB
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
 *
 * Remarques:
 *  - Pas d’usage de created_at/updated_at pour éviter l’erreur “champ inconnu”.
 *  - On récupère les payments UNIQUEMENT pour les passeports listés (IN (...)).
 */
router.get("/", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const offre = String(req.query.offre || "").trim();
    let limit = Number(req.query.limit || 300);
    if (!Number.isFinite(limit) || limit <= 0) limit = 300;
    if (limit > 1000) limit = 1000;

    // Base URL pour fabriquer des URL absolues d’images
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    // — Étape 1: charger les pèlerins
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
      whereParts.push(`${Q("offre")} = ?`);
      params.push(offre);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const [pRows] = await sequelize.query(
      `
      SELECT
        id,
        photo_pelerin_path, photo_passeport_path,
        nom, prenoms, date_naissance, lieu_naissance, sexe,
        adresse, contact, num_passeport,
        offre, voyage, annee_voyage,
        created_by_name, created_by_id
      FROM ${Q("pelerins")}
      ${whereSql}
      ORDER BY id DESC
      LIMIT ${limit}
      `,
      { replacements: params }
    );

    const pelerins = (pRows || []).map((r) => normPelerin(r, baseUrl));

    // Si pas de pèlerins, on renvoie directement (payments vide)
    if (!pelerins.length) {
      return res.json({ pelerins: [], payments: [] });
    }

    // — Étape 2: charger les payments pour ces passeports
    const passports = pelerins
      .map((p) => p.passeport)
      .filter(Boolean);

    // Filtre IN
    const placeholders = passports.map(() => "?").join(",");
    const [payRows] = await sequelize.query(
      `
      SELECT
        id, ref, passeport, nom, prenoms, mode, montant, totalDu, reduction, date, statut
      FROM ${Q("payments")}
      WHERE ${Q("passeport")} IN (${placeholders})
      ORDER BY id DESC
      `,
      { replacements: passports }
    );

    const payments = (payRows || []).map(normPayment);

    return res.json({ pelerins, payments });
  } catch (err) {
    console.error("❌ GET /api/pelerinspaiement:", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
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
    if (!passport) return res.status(400).json({ message: "Paramètre 'passport' requis." });

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const [[row]] = await sequelize.query(
      `
      SELECT
        id,
        photo_pelerin_path, photo_passeport_path,
        nom, prenoms, date_naissance, lieu_naissance, sexe,
        adresse, contact, num_passeport,
        offre, voyage, annee_voyage,
        created_by_name, created_by_id
      FROM ${Q("pelerins")}
      WHERE ${Q("num_passeport")} = ?
      LIMIT 1
      `,
      { replacements: [passport] }
    );

    const pelerin = row ? normPelerin(row, baseUrl) : null;

    const [payRows] = await sequelize.query(
      `
      SELECT
        id, ref, passeport, nom, prenoms, mode, montant, totalDu, reduction, date, statut
      FROM ${Q("payments")}
      WHERE ${Q("passeport")} = ?
      ORDER BY id DESC
      `,
      { replacements: [passport] }
    );

    const payments = (payRows || []).map(normPayment);

    res.json({ pelerin, payments });
  } catch (err) {
    console.error("❌ GET /api/pelerinspaiement/by-passport:", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

module.exports = router;
