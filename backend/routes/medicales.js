// backend/routes/medicales.js
const express = require("express");
const { sequelize } = require("../db");

const router = express.Router();
router.use(express.json());

/* ------------------------------
   Helpers
------------------------------ */
function normBody(b = {}) {
  const x = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
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
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
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

    const [rows] = await sequelize.query(
      `
      SELECT SQL_CALC_FOUND_ROWS
        id, pelerin_id, numero_cmah, passeport, nom, prenoms, pouls, carnet_vaccins, groupe_sanguin,
        covid, poids, tension, vulnerabilite, diabete, maladie_cardiaque,
        analyse_psychiatrique, accompagnements, examen_paraclinique, antecedents,
        created_at, updated_at
      FROM medicales
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
      `,
      { replacements: params }
    );
    const [[{ "FOUND_ROWS()": total } = { "FOUND_ROWS()": 0 }]] = await sequelize.query("SELECT FOUND_ROWS()");

    return res.json({ items: rows || [], total: total || 0 });
  } catch (err) {
    console.error("GET /api/medicales", err);
    return res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ------------------------------
   GET /api/medicales/by-passport?passport=XXX
   -> { items } (même pattern que /pelerins?search=)
------------------------------ */
router.get("/by-passport", async (req, res) => {
  try {
    const pass = (req.query.passport || "").toString().trim().toUpperCase();
    if (!pass) return res.json({ items: [] });

    const [rows] = await sequelize.query(
      `
      SELECT id, pelerin_id, numero_cmah, passeport, nom, prenoms, pouls, carnet_vaccins, groupe_sanguin,
             covid, poids, tension, vulnerabilite, diabete, maladie_cardiaque,
             analyse_psychiatrique, accompagnements, examen_paraclinique, antecedents,
             created_at, updated_at
      FROM medicales
      WHERE UPPER(passeport) = ?
      ORDER BY created_at DESC
      `,
      { replacements: [pass] }
    );

    return res.json({ items: rows || [] });
  } catch (err) {
    console.error("GET /api/medicales/by-passport", err);
    return res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ------------------------------
   GET /api/medicales/:id
   -> objet
------------------------------ */
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await sequelize.query(
      `
      SELECT id, pelerin_id, numero_cmah, passeport, nom, prenoms, pouls, carnet_vaccins, groupe_sanguin,
             covid, poids, tension, vulnerabilite, diabete, maladie_cardiaque,
             analyse_psychiatrique, accompagnements, examen_paraclinique, antecedents,
             created_at, updated_at
      FROM medicales
      WHERE id = ?
      LIMIT 1
      `,
      { replacements: [req.params.id] }
    );
    const row = rows?.[0];
    if (!row) return res.status(404).json({ message: "Introuvable" });
    return res.json(row);
  } catch (err) {
    console.error("GET /api/medicales/:id", err);
    return res.status(500).json({ message: "Erreur serveur", detail: err.message });
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
        message: "Le champ 'passeport' doit contenir 5 à 15 caractères alphanumériques.",
      });
    }

    // FK pelerin_id (si existant)
    const [pelRows] = await sequelize.query(
      "SELECT id FROM pelerins WHERE UPPER(num_passeport) = ? LIMIT 1",
      { replacements: [b.passeport] }
    );
    const pelerinId = pelRows?.[0]?.id ?? null;

    const [result] = await sequelize.query(
      `
      INSERT INTO medicales (
        pelerin_id, numero_cmah, passeport,
        nom, prenoms, pouls, carnet_vaccins, groupe_sanguin,
        covid, poids, tension, vulnerabilite, diabete, maladie_cardiaque,
        analyse_psychiatrique, accompagnements, examen_paraclinique, antecedents,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())
      `,
      {
        replacements: [
          pelerinId, b.numero_cmah, b.passeport,
          b.nom, b.prenoms, b.pouls, b.carnet_vaccins, b.groupe_sanguin,
          b.covid, b.poids, b.tension, b.vulnerabilite, b.diabete, b.maladie_cardiaque,
          b.analyse_psychiatrique, b.accompagnements, b.examen_paraclinique, b.antecedents,
        ],
      }
    );

    const insertedId = result?.insertId ?? null;
    const [rows2] = await sequelize.query("SELECT * FROM medicales WHERE id = ?", {
      replacements: [insertedId],
    });

    return res.status(201).json({ ok: true, item: rows2?.[0] || null });
  } catch (err) {
    console.error("POST /api/medicales", err);
    const msg = err?.original?.sqlMessage || err?.message || "Erreur serveur";
    return res.status(500).json({ ok: false, message: "Erreur serveur", detail: msg });
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
        message: "Le champ 'passeport' doit contenir 5 à 15 caractères alphanumériques.",
      });
    }

    const fields = [
      "numero_cmah","passeport","nom","prenoms","pouls","carnet_vaccins","groupe_sanguin",
      "covid","poids","tension","vulnerabilite","diabete","maladie_cardiaque",
      "analyse_psychiatrique","accompagnements","examen_paraclinique","antecedents",
    ];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(b, f)) {
        sets.push(`${f} = ?`);
        params.push(b[f]);
      }
    }
    sets.push("updated_at = NOW()");
    const id = req.params.id;

    await sequelize.query(
      `UPDATE medicales SET ${sets.join(", ")} WHERE id = ?`,
      { replacements: [...params, id] }
    );

    const [row] = await sequelize.query("SELECT * FROM medicales WHERE id = ? LIMIT 1", {
      replacements: [id],
    });

    return res.json({ ok: true, item: row?.[0] || null });
  } catch (err) {
    console.error("PUT /api/medicales/:id", err);
    return res.status(500).json({ ok: false, message: "Erreur serveur", detail: err.message });
  }
});

/* ------------------------------
   DELETE /api/medicales/:id
   -> { ok:true }
------------------------------ */
router.delete("/:id", async (req, res) => {
  try {
    await sequelize.query("DELETE FROM medicales WHERE id = ?", {
      replacements: [req.params.id],
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/medicales/:id", err);
    return res.status(500).json({ ok: false, message: "Erreur serveur", detail: err.message });
  }
});

module.exports = router;
