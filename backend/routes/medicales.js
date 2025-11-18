// backend/routes/medicales.js
const express = require("express");
const { query } = require("../db");

const router = express.Router();
router.use(express.json());

/* ------------------------------
   Helpers
------------------------------ */
function normBody(b = {}) {
  const x = (v) =>
    v === undefined || v === null || String(v).trim() === ""
      ? null
      : String(v).trim();
  const passeport = x(b.passeport)?.toUpperCase() || null;

  return {
    numero_cmah: x(b.numero_cmah),
    passeport,
    nom: x(b.nom),
    prenoms: x(b.prenoms),
    pouls: x(b.pouls),
    carnet_vaccins: x(b.carnet_vaccins),
    groupe_sanguin: x(b.groupe_sanguin),
    covid: x(b.covid),
    poids: x(b.poids),
    tension: x(b.tension),
    vulnerabilite: x(b.vulnerabilite),
    diabete: x(b.diabete),
    maladie_cardiaque: x(b.maladie_cardiaque),
    analyse_psychiatrique: x(b.analyse_psychiatrique),
    accompagnements: x(b.accompagnements),
    examen_paraclinique: x(b.examen_paraclinique),
    antecedents: x(b.antecedents),
  };
}
function isValidPassport(p) {
  return !!p && /^[A-Z0-9]{5,15}$/.test(p);
}

/* ------------------------------
   GET /api/medicales
   - ?search= (passeport, nom, prenoms…)
   - ?limit= ?offset=
   -> { items, total }
------------------------------ */
router.get("/", async (req, res) => {
  try {
    const search = (req.query.search || "").toString().trim();
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 100, 1),
      500
    );
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let where = "";
    const params = [];
    if (search) {
      where = `WHERE
        UPPER(passeport) LIKE ?
        OR UPPER(nom) LIKE ?
        OR UPPER(prenoms) LIKE ?
        OR numero_cmah LIKE ?`;
      const like = `%${search.toUpperCase()}%`;
      params.push(like, like, like, `%${search}%`);
    }

    // total
    const countRes = await query(
      `
      SELECT COUNT(*) AS total
      FROM medicales
      ${where}
      `,
      params
    );
    const total = countRes.rows?.[0]?.total || 0;

    // items
    const itemsRes = await query(
      `
      SELECT
        id, pelerin_id, numero_cmah, passeport, nom, prenoms, pouls,
        carnet_vaccins, groupe_sanguin,
        covid, poids, tension, vulnerabilite, diabete, maladie_cardiaque,
        analyse_psychiatrique, accompagnements, examen_paraclinique, antecedents,
        created_at, updated_at
      FROM medicales
      ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    return res.json({ items: itemsRes.rows || [], total });
  } catch (err) {
    console.error("GET /api/medicales", err);
    return res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ------------------------------
   GET /api/medicales/by-passport?passport=XXX
   -> { items }
------------------------------ */
router.get("/by-passport", async (req, res) => {
  try {
    const pass = (req.query.passport || "").toString().trim().toUpperCase();
    if (!pass) return res.json({ items: [] });

    const result = await query(
      `
      SELECT id, pelerin_id, numero_cmah, passeport, nom, prenoms, pouls,
             carnet_vaccins, groupe_sanguin,
             covid, poids, tension, vulnerabilite, diabete, maladie_cardiaque,
             analyse_psychiatrique, accompagnements, examen_paraclinique, antecedents,
             created_at, updated_at
      FROM medicales
      WHERE UPPER(passeport) = ?
      ORDER BY created_at DESC
      `,
      [pass]
    );

    return res.json({ items: result.rows || [] });
  } catch (err) {
    console.error("GET /api/medicales/by-passport", err);
    return res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ------------------------------
   GET /api/medicales/:id
   -> objet
------------------------------ */
router.get("/:id", async (req, res) => {
  try {
    const result = await query(
      `
      SELECT id, pelerin_id, numero_cmah, passeport, nom, prenoms, pouls,
             carnet_vaccins, groupe_sanguin,
             covid, poids, tension, vulnerabilite, diabete, maladie_cardiaque,
             analyse_psychiatrique, accompagnements, examen_paraclinique, antecedents,
             created_at, updated_at
      FROM medicales
      WHERE id = ?
      LIMIT 1
      `,
      [req.params.id]
    );
    const row = result.rows?.[0];
    if (!row) return res.status(404).json({ message: "Introuvable" });
    return res.json(row);
  } catch (err) {
    console.error("GET /api/medicales/:id", err);
    return res
      .status(500)
      .json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ------------------------------
   POST /api/medicales
   Body JSON (snake_case)
   -> { ok:true, item }
------------------------------ */
router.post("/", async (req, res) => {
  try {
    const b = normBody(req.body || {});
    if (!isValidPassport(b.passeport)) {
      return res.status(400).json({
        message:
          "Le champ 'passeport' doit contenir 5 à 15 caractères alphanumériques.",
      });
    }

    // FK pelerin_id (si existant)
    const pelRes = await query(
      "SELECT id FROM pelerins WHERE UPPER(num_passeport) = ? LIMIT 1",
      [b.passeport]
    );
    const pelerinId = pelRes.rows?.[0]?.id ?? null;

    const insertRes = await query(
      `
      INSERT INTO medicales (
        pelerin_id, numero_cmah, passeport,
        nom, prenoms, pouls, carnet_vaccins, groupe_sanguin,
        covid, poids, tension, vulnerabilite, diabete, maladie_cardiaque,
        analyse_psychiatrique, accompagnements, examen_paraclinique, antecedents,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
      `,
      [
        pelerinId,
        b.numero_cmah,
        b.passeport,
        b.nom,
        b.prenoms,
        b.pouls,
        b.carnet_vaccins,
        b.groupe_sanguin,
        b.covid,
        b.poids,
        b.tension,
        b.vulnerabilite,
        b.diabete,
        b.maladie_cardiaque,
        b.analyse_psychiatrique,
        b.accompagnements,
        b.examen_paraclinique,
        b.antecedents,
      ]
    );

    const item = insertRes.rows?.[0] || null;

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    console.error("POST /api/medicales", err);
    const msg = err?.message || "Erreur serveur";
    return res
      .status(500)
      .json({ ok: false, message: "Erreur serveur", detail: msg });
  }
});

/* ------------------------------
   PUT /api/medicales/:id
   Body JSON (snake_case)
   -> { ok:true, item }
------------------------------ */
router.put("/:id", async (req, res) => {
  try {
    const b = normBody(req.body || {});
    if (b.passeport && !isValidPassport(b.passeport)) {
      return res.status(400).json({
        message:
          "Le champ 'passeport' doit contenir 5 à 15 caractères alphanumériques.",
      });
    }

    const fields = [
      "numero_cmah",
      "passeport",
      "nom",
      "prenoms",
      "pouls",
      "carnet_vaccins",
      "groupe_sanguin",
      "covid",
      "poids",
      "tension",
      "vulnerabilite",
      "diabete",
      "maladie_cardiaque",
      "analyse_psychiatrique",
      "accompagnements",
      "examen_paraclinique",
      "antecedents",
    ];

    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(b, f)) {
        sets.push(`${f} = ?`);
        params.push(b[f]);
      }
    }
    sets.push("updated_at = CURRENT_TIMESTAMP");

    const id = req.params.id;
    await query(
      `UPDATE medicales SET ${sets.join(", ")} WHERE id = ?`,
      [...params, id]
    );

    const rowRes = await query(
      "SELECT * FROM medicales WHERE id = ? LIMIT 1",
      [id]
    );
    const item = rowRes.rows?.[0] || null;

    return res.json({ ok: true, item });
  } catch (err) {
    console.error("PUT /api/medicales/:id", err);
    return res
      .status(500)
      .json({ ok: false, message: "Erreur serveur", detail: err.message });
  }
});

/* ------------------------------
   DELETE /api/medicales/:id
   -> { ok:true }
------------------------------ */
router.delete("/:id", async (req, res) => {
  try {
    await query("DELETE FROM medicales WHERE id = ?", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/medicales/:id", err);
    return res
      .status(500)
      .json({ ok: false, message: "Erreur serveur", detail: err.message });
  }
});

module.exports = router;
