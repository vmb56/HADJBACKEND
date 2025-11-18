// backend/routes/pelerins.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { query } = require("../db"); // ⬅️ Turso

const router = express.Router();

/* ========= /by-passport ========= */
router.get("/by-passport", async (req, res) => {
  try {
    const passport = String(req.query.passport || "").trim();
    if (!passport) {
      return res
        .status(400)
        .json({ message: "Paramètre 'passport' requis." });
    }

    const result = await query(
      `
      SELECT id, nom, prenoms, num_passeport
      FROM pelerins
      WHERE num_passeport LIKE ?
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [`%${passport}%`]
    );

    return res.json(result.rows || []);
  } catch (err) {
    console.error("❌ GET /api/pelerins/by-passport:", err);
    res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ========= stockage fichiers ========= */
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "pelerins");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path
      .basename(file.originalname || "file", ext)
      .replace(/\s+/g, "_");
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const upload = multer({ storage });

/* ========= helpers fichiers ========= */
const toPublicPath = (filename) =>
  filename ? `/uploads/pelerins/${filename}` : null;

function existsSyncSafe(p) {
  try {
    return p && fs.existsSync(p);
  } catch {
    return false;
  }
}
function removeFileIfExists(publicPath) {
  if (!publicPath) return;
  const abs = path.join(__dirname, "..", publicPath.replace(/^\/+/, ""));
  if (existsSyncSafe(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch {}
  }
}

const UPLOAD_FIELDS = upload.fields([
  { name: "photoPelerin", maxCount: 1 },
  { name: "photoPasseport", maxCount: 1 },
]);

/* ============================================================================
  POST /api/pelerins — création (multipart + champs)
============================================================================ */
router.post("/", UPLOAD_FIELDS, async (req, res) => {
  try {
    const b = req.body || {};

    const photoPelerinPath = req.files?.photoPelerin?.[0]
      ? toPublicPath(req.files.photoPelerin[0].filename)
      : null;
    const photoPasseportPath = req.files?.photoPasseport?.[0]
      ? toPublicPath(req.files.photoPasseport[0].filename)
      : null;

    if (
      !b.nom ||
      !b.prenoms ||
      !b.dateNaissance ||
      !b.sexe ||
      !b.contact ||
      !b.numPasseport ||
      !b.anneeVoyage
    ) {
      return res
        .status(400)
        .json({ message: "Champs obligatoires manquants." });
    }

    const anneeVoyage =
      parseInt(b.anneeVoyage, 10) || new Date().getFullYear();
    const sexe = b.sexe === "M" ? "M" : b.sexe === "F" ? "F" : null;
    if (!sexe) {
      return res.status(400).json({ message: "Sexe invalide (M/F)." });
    }

    const sql = `
      INSERT INTO pelerins (
        photo_pelerin_path, photo_passeport_path,
        nom, prenoms, date_naissance, lieu_naissance, sexe,
        adresse, contact, num_passeport,
        offre, voyage, annee_voyage,
        ur_nom, ur_prenoms, ur_contact, ur_residence,
        created_by_name, created_by_id,
        created_at, updated_at
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    const params = [
      photoPelerinPath,
      photoPasseportPath,
      String(b.nom).trim(),
      String(b.prenoms).trim(),
      b.dateNaissance,
      b.lieuNaissance || null,
      sexe,
      b.adresse || null,
      String(b.contact).trim(),
      String(b.numPasseport).trim(),
      b.offre || null,
      b.voyage || null,
      anneeVoyage,
      b.urNom || null,
      b.urPrenoms || null,
      b.urContact || null,
      b.urResidence || null,
      b.createdByName || null,
      b.createdById ? Number(b.createdById) : null,
    ];

    const insertRes = await query(sql, params);

    // libSQL ne donne pas insertId, mieux vaut retourner juste un ok
    // ou récupérer le dernier enregistrement avec ROWID si besoin.
    // On reste simple : on renvoie juste un message.
    return res
      .status(201)
      .json({ message: "Pèlerin enregistré." });
  } catch (err) {
    console.error("❌ POST /api/pelerins:", err);
    return res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ============================================================================
  GET /api/pelerins — liste (search facultatif)
============================================================================ */
router.get("/", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    let where = "";
    const params = [];

    if (search) {
      where =
        "WHERE nom LIKE ? OR prenoms LIKE ? OR num_passeport LIKE ? OR contact LIKE ? OR created_by_name LIKE ?";
      const p = `%${search}%`;
      params.push(p, p, p, p, p);
    }

    const result = await query(
      `
      SELECT
        id,
        photo_pelerin_path, photo_passeport_path,
        nom, prenoms, date_naissance, lieu_naissance, sexe,
        adresse, contact, num_passeport,
        offre, voyage, annee_voyage,
        ur_nom, ur_prenoms, ur_contact, ur_residence,
        created_by_name, created_by_id,
        created_at, updated_at
      FROM pelerins
      ${where}
      ORDER BY created_at DESC
      `,
      params
    );

    const rows = result.rows || [];
    res.json({ items: rows, total: rows.length });
  } catch (err) {
    console.error("❌ GET /api/pelerins:", err);
    res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ============================================================================
  GET /api/pelerins/:id — lecture d’un enregistrement
============================================================================ */
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id invalide" });

    const result = await query(
      `
      SELECT
        id,
        photo_pelerin_path, photo_passeport_path,
        nom, prenoms, date_naissance, lieu_naissance, sexe,
        adresse, contact, num_passeport,
        offre, voyage, annee_voyage,
        ur_nom, ur_prenoms, ur_contact, ur_residence,
        created_by_name, created_by_id,
        created_at, updated_at
      FROM pelerins WHERE id = ?
      `,
      [id]
    );

    const row = result.rows?.[0];
    if (!row) return res.status(404).json({ message: "Introuvable" });
    res.json(row);
  } catch (err) {
    console.error("❌ GET /api/pelerins/:id:", err);
    res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ============================================================================
  PUT /api/pelerins/:id — mise à jour (multipart **ou** JSON)
============================================================================ */
router.put(
  "/:id",
  upload.fields([
    { name: "photoPelerin", maxCount: 1 },
    { name: "photoPasseport", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ message: "id invalide" });

      // Détecter multipart
      const isMultipart =
        req.is("multipart/form-data") ||
        (req.files &&
          (req.files.photoPelerin || req.files.photoPasseport));

      const b = isMultipart ? req.body : req.body || {};

      // Récupérer l'ancien enregistrement pour éventuellement supprimer les anciens fichiers
      const currentRes = await query(
        `
        SELECT photo_pelerin_path, photo_passeport_path
        FROM pelerins
        WHERE id = ?
        `,
        [id]
      );
      const current = currentRes.rows?.[0] || null;
      if (!current) {
        return res.status(404).json({ message: "Introuvable" });
      }

      // Normalisation minimale
      const payload = {
        nom: b.nom ?? undefined,
        prenoms: b.prenoms ?? undefined,
        date_naissance: b.date_naissance ?? b.dateNaissance ?? undefined,
        lieu_naissance: b.lieu_naissance ?? b.lieuNaissance ?? undefined,
        sexe: b.sexe ?? undefined,
        adresse: b.adresse ?? undefined,
        contact: b.contact ?? b.contacts ?? undefined,
        num_passeport: b.num_passeport ?? b.numPasseport ?? undefined,
        offre: b.offre ?? undefined,
        voyage: b.voyage ?? undefined,
        annee_voyage: b.annee_voyage ?? b.anneeVoyage ?? undefined,
        ur_nom: b.ur_nom ?? b.urgenceNom ?? undefined,
        ur_prenoms: b.ur_prenoms ?? b.urgencePrenoms ?? undefined,
        ur_contact: b.ur_contact ?? b.urgenceContact ?? undefined,
        ur_residence: b.ur_residence ?? b.urgenceResidence ?? undefined,
      };

      let photoPelerinPath = null;
      let photoPasseportPath = null;

      if (isMultipart) {
        if (req.files?.photoPelerin?.[0]) {
          photoPelerinPath = toPublicPath(
            req.files.photoPelerin[0].filename
          );
        }
        if (req.files?.photoPasseport?.[0]) {
          photoPasseportPath = toPublicPath(
            req.files.photoPasseport[0].filename
          );
        }
      }

      const sets = [];
      const params = [];

      for (const [col, val] of Object.entries(payload)) {
        if (val !== undefined) {
          if (col === "sexe" && val) {
            const v = String(val).toUpperCase();
            if (v !== "M" && v !== "F") {
              return res
                .status(400)
                .json({ message: "Sexe invalide (M/F)." });
            }
            sets.push(`${col} = ?`);
            params.push(v);
          } else {
            sets.push(`${col} = ?`);
            params.push(val);
          }
        }
      }

      if (photoPelerinPath !== null) {
        sets.push("photo_pelerin_path = ?");
        params.push(photoPelerinPath);
      }
      if (photoPasseportPath !== null) {
        sets.push("photo_passeport_path = ?");
        params.push(photoPasseportPath);
      }

      if (!sets.length) {
        return res
          .status(400)
          .json({ message: "Aucun champ à mettre à jour." });
      }

      sets.push("updated_at = CURRENT_TIMESTAMP");
      params.push(id);

      await query(
        `UPDATE pelerins SET ${sets.join(", ")} WHERE id = ?`,
        params
      );

      // Nettoyage des anciennes photos si remplacées
      if (photoPelerinPath && current.photo_pelerin_path) {
        removeFileIfExists(current.photo_pelerin_path);
      }
      if (photoPasseportPath && current.photo_passeport_path) {
        removeFileIfExists(current.photo_passeport_path);
      }

      // Renvoie la ligne mise à jour
      const rowRes = await query(
        `
        SELECT
          id, photo_pelerin_path, photo_passeport_path,
          nom, prenoms, date_naissance, lieu_naissance, sexe,
          adresse, contact, num_passeport, offre, voyage, annee_voyage,
          ur_nom, ur_prenoms, ur_contact, ur_residence,
          created_by_name, created_by_id, created_at, updated_at
        FROM pelerins WHERE id = ?
        `,
        [id]
      );

      const row = rowRes.rows?.[0] || null;

      return res.json({
        message: "Mise à jour effectuée",
        item: row,
      });
    } catch (err) {
      console.error("❌ PUT /api/pelerins/:id:", err);
      res
        .status(500)
        .json({ message: "Erreur serveur", detail: err.message });
    }
  }
);

/* ============================================================================
  DELETE /api/pelerins/:id — supprime ligne + fichiers
============================================================================ */
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "id invalide" });
    }

    const rowRes = await query(
      `SELECT photo_pelerin_path, photo_passeport_path FROM pelerins WHERE id = ?`,
      [id]
    );
    const row = rowRes.rows?.[0];
    if (!row) {
      return res.status(404).json({ message: "Introuvable" });
    }

    await query(`DELETE FROM pelerins WHERE id = ?`, [id]);

    // nettoyage fichiers
    removeFileIfExists(row.photo_pelerin_path);
    removeFileIfExists(row.photo_passeport_path);

    res.json({ message: "Supprimé" });
  } catch (err) {
    console.error("❌ DELETE /api/pelerins/:id:", err);
    res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

module.exports = router;
