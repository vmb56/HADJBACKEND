// backend/routes/vols.js
const express = require("express");
const router = express.Router();

// Instance sequelize (pas de modèles)
const { sequelize } = require("../db");

/* =============== Helpers =============== */
function validIATA(code) {
  return /^[A-Z]{3}$/.test(String(code || "").toUpperCase());
}
function normCode(code) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
}
function toDate(input) {
  if (!input) return null;
  const s = String(input).replace(" ", "T");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function labelDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function isPg() {
  return (sequelize.getDialect?.() || "").toLowerCase() === "postgres";
}

// Quote helper (Postgres) pour les colonnes camelCase
const Q = (c) => (isPg() ? `"${c}"` : c);

// Colonnes “sélectionnées” avec alias stables
const flightCols = [
  "id", "code", "company", "fromCode", "fromDate", "toCode", "toDate", "duration", "createdAt", "updatedAt"
].map(k => `${Q(k)} AS "${k}"`).join(", ");
const passengerCols = [
  "id", "fullname", "seat", "passport", "photoUrl", "flightId"
].map(k => `${Q(k)} AS "${k}"`).join(", ");

// Petit utilitaire de log propre (diagnostic 500)
function logError(where, e) {
  // eslint-disable-next-line no-console
  console.error(`[vols] ${where}:`, e && (e.stack || e.message || e));
  if (e?.parent?.sql) console.error("[SQL]", e.parent.sql);
  if (e?.parent?.parameters) console.error("[Params]", e.parent.parameters);
}

/* ============== GET /api/vols ============== */
router.get("/", async (req, res) => {
  try {
    const [flights] = await sequelize.query(
      `SELECT ${flightCols}
       FROM ${Q("flights")}
       ORDER BY ${Q("createdAt")} DESC`
    );

    if (!flights.length) return res.json({ items: [] });

    const ids = flights.map((f) => f.id);
    const placeholders = ids.map(() => "?").join(",");
    const [passengers] = await sequelize.query(
      `SELECT ${passengerCols}
       FROM ${Q("passengers")}
       WHERE ${Q("flightId")} IN (${placeholders})`,
      { replacements: ids }
    );

    const grouped = new Map();
    flights.forEach((f) => grouped.set(f.id, []));
    passengers.forEach((p) => {
      const arr = grouped.get(p.flightId);
      if (arr) arr.push({ id: p.id, fullname: p.fullname, seat: p.seat, passport: p.passport, photoUrl: p.photoUrl });
    });

    const items = flights.map((f) => ({
      id: f.id,
      code: f.code,
      company: f.company,
      from: { code: f.fromCode, date: f.fromDate },
      to:   { code: f.toCode,   date: f.toDate },
      duration: f.duration,
      passengers: grouped.get(f.id) || [],
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));

    res.json({ items });
  } catch (e) {
    logError("GET /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ============== POST /api/vols ============== */
router.post("/", async (req, res) => {
  try {
    const { code, company, from, to, duration } = req.body || {};
    if (!code || !company || !from?.code || !from?.date || !to?.code || !to?.date || !duration) {
      return res.status(400).json({ message: "Champs requis manquants." });
    }

    const payload = {
      code: normCode(code),
      company: String(company).trim(),
      fromCode: String(from.code).trim().toUpperCase(),
      fromDate: toDate(from.date),
      toCode: String(to.code).trim().toUpperCase(),
      toDate: toDate(to.date),
      duration: String(duration).trim(),
    };

    if (!validIATA(payload.fromCode) || !validIATA(payload.toCode)) {
      return res.status(400).json({ message: "Codes IATA invalides (ex: DSS, JED)." });
    }
    if (!payload.fromDate || !payload.toDate || payload.toDate <= payload.fromDate) {
      return res.status(400).json({ message: "L’arrivée doit être postérieure au départ." });
    }

    let insertedId;
    if (isPg()) {
      const [rows] = await sequelize.query(
        `INSERT INTO ${Q("flights")} (${Q("code")}, ${Q("company")}, ${Q("fromCode")}, ${Q("fromDate")}, ${Q("toCode")}, ${Q("toDate")}, ${Q("duration")}, ${Q("createdAt")}, ${Q("updatedAt")})
         VALUES (:code, :company, :fromCode, :fromDate, :toCode, :toDate, :duration, NOW(), NOW())
         RETURNING ${Q("id")} AS "id"`,
        { replacements: payload }
      );
      insertedId = rows[0].id;
    } else {
      const [result] = await sequelize.query(
        `INSERT INTO ${Q("flights")} (${Q("code")}, ${Q("company")}, ${Q("fromCode")}, ${Q("fromDate")}, ${Q("toCode")}, ${Q("toDate")}, ${Q("duration")}, ${Q("createdAt")}, ${Q("updatedAt")})
         VALUES (:code, :company, :fromCode, :fromDate, :toCode, :toDate, :duration, NOW(), NOW())`,
        { replacements: payload }
      );
      insertedId = result?.insertId;
      if (!insertedId) {
        // fallback MySQL/MariaDB
        const [r] = await sequelize.query(`SELECT LAST_INSERT_ID() AS id`);
        insertedId = r?.[0]?.id;
      }
    }

    const [rows2] = await sequelize.query(
      `SELECT ${flightCols}
       FROM ${Q("flights")}
       WHERE ${Q("id")} = :id`,
      { replacements: { id: insertedId } }
    );
    const f = rows2[0];

    res.status(201).json({
      id: f.id,
      code: f.code,
      company: f.company,
      from: { code: f.fromCode, date: f.fromDate },
      to:   { code: f.toCode,   date: f.toDate },
      duration: f.duration,
      passengers: [],
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    });
  } catch (e) {
    logError("POST /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ============== PUT /api/vols/:id ============== */
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { code, company, from, to, duration } = req.body || {};
    if (!code || !company || !from?.code || !from?.date || !to?.code || !to?.date || !duration) {
      return res.status(400).json({ message: "Champs requis manquants." });
    }

    const updated = {
      id,
      code: normCode(code),
      company: String(company).trim(),
      fromCode: String(from.code).trim().toUpperCase(),
      fromDate: toDate(from.date),
      toCode: String(to.code).trim().toUpperCase(),
      toDate: toDate(to.date),
      duration: String(duration).trim(),
    };

    if (!validIATA(updated.fromCode) || !validIATA(updated.toCode)) {
      return res.status(400).json({ message: "Codes IATA invalides (ex: DSS, JED)." });
    }
    if (!updated.fromDate || !updated.toDate || updated.toDate <= updated.fromDate) {
      return res.status(400).json({ message: "L’arrivée doit être postérieure au départ." });
    }

    const [existsRows] = await sequelize.query(
      `SELECT ${Q("id")} AS "id" FROM ${Q("flights")} WHERE ${Q("id")} = :id`,
      { replacements: { id } }
    );
    if (!existsRows.length) return res.status(404).json({ message: "Vol introuvable" });

    // ✅ SQL propre (pas de :=)
    const updateSql = `
      UPDATE ${Q("flights")}
      SET
        ${Q("code")}=:code,
        ${Q("company")}=:company,
        ${Q("fromCode")}=:fromCode,
        ${Q("fromDate")}=:fromDate,
        ${Q("toCode")}=:toCode,
        ${Q("toDate")}=:toDate,
        ${Q("duration")}=:duration,
        ${Q("updatedAt")}=NOW()
      WHERE ${Q("id") }=:id
    `;
    await sequelize.query(updateSql, { replacements: updated });

    // Recharger
    const [rowsSel] = await sequelize.query(
      `SELECT ${flightCols}
       FROM ${Q("flights")}
       WHERE ${Q("id")} = :id`,
      { replacements: { id } }
    );
    const f = rowsSel[0];
    if (!f) return res.status(404).json({ message: "Vol introuvable après MAJ" });

    const [pax] = await sequelize.query(
      `SELECT ${["id","fullname","seat","passport","photoUrl"].map(c => `${Q(c)} AS "${c}"`).join(", ")}
       FROM ${Q("passengers")}
       WHERE ${Q("flightId")} = :id
       ORDER BY ${Q("id")} ASC`,
      { replacements: { id } }
    );

    res.json({
      id: f.id,
      code: f.code,
      company: f.company,
      from: { code: f.fromCode, date: f.fromDate },
      to:   { code: f.toCode,   date: f.toDate },
      duration: f.duration,
      passengers: pax,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    });
  } catch (e) {
    logError("PUT /:id", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ============== DELETE /api/vols/:id ============== */
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await sequelize.query(`DELETE FROM ${Q("passengers")} WHERE ${Q("flightId")} = :id`, { replacements: { id } });
    await sequelize.query(`DELETE FROM ${Q("flights")} WHERE ${Q("id")} = :id`, { replacements: { id } });
    res.json({ message: "Supprimé" });
  } catch (e) {
    logError("DELETE /:id", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ====== POST /api/vols/:id/passagers ====== */
router.post("/:id/passagers", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { fullname, seat, passport, photoUrl } = req.body || {};
    if (!fullname) return res.status(400).json({ message: "Nom requis" });

    const [existsRows] = await sequelize.query(
      `SELECT ${Q("id")} AS "id" FROM ${Q("flights")} WHERE ${Q("id")} = :id`,
      { replacements: { id } }
    );
    if (!existsRows[0]) return res.status(404).json({ message: "Vol introuvable" });

    const seatNorm = String(seat || "").trim().toUpperCase();
    if (seatNorm) {
      const [takenRows] = await sequelize.query(
        `SELECT 1 AS t FROM ${Q("passengers")}
         WHERE ${Q("flightId") }=:id AND UPPER(${Q("seat")})=:seat
         LIMIT 1`,
        { replacements: { id, seat: seatNorm } }
      );
      if (takenRows[0]) return res.status(409).json({ message: `Siège ${seatNorm} déjà attribué.` });
    }

    let insertedId;
    if (isPg()) {
      const [rows] = await sequelize.query(
        `INSERT INTO ${Q("passengers")} (${Q("fullname")}, ${Q("seat")}, ${Q("passport")}, ${Q("photoUrl")}, ${Q("flightId")}, ${Q("createdAt")}, ${Q("updatedAt")})
         VALUES (:fullname, :seat, :passport, :photoUrl, :flightId, NOW(), NOW())
         RETURNING ${Q("id")} AS "id"`,
        {
          replacements: {
            fullname: String(fullname).trim(),
            seat: seatNorm || "—",
            passport: String(passport || "").trim(),
            photoUrl: String(photoUrl || "").trim(),
            flightId: id,
          },
        }
      );
      insertedId = rows[0].id;
    } else {
      const [result] = await sequelize.query(
        `INSERT INTO ${Q("passengers")} (${Q("fullname")}, ${Q("seat")}, ${Q("passport")}, ${Q("photoUrl")}, ${Q("flightId")}, ${Q("createdAt")}, ${Q("updatedAt")})
         VALUES (:fullname, :seat, :passport, :photoUrl, :flightId, NOW(), NOW())`,
        {
          replacements: {
            fullname: String(fullname).trim(),
            seat: seatNorm || "—",
            passport: String(passport || "").trim(),
            photoUrl: String(photoUrl || "").trim(),
            flightId: id,
          },
        }
      );
      insertedId = result?.insertId;
      if (!insertedId) {
        const [r] = await sequelize.query(`SELECT LAST_INSERT_ID() AS id`);
        insertedId = r?.[0]?.id;
      }
    }

    const [rows3] = await sequelize.query(
      `SELECT ${["id","fullname","seat","passport","photoUrl"].map(c => `${Q(c)} AS "${c}"`).join(", ")}
       FROM ${Q("passengers")} WHERE ${Q("id")} = :pid`,
      { replacements: { pid: insertedId } }
    );
    res.status(201).json(rows3[0]);
  } catch (e) {
    logError("POST /:id/passagers", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* === DELETE /api/vols/:id/passagers/:pid === */
router.delete("/:id/passagers/:pid", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const pid = Number(req.params.pid);

    const [chk] = await sequelize.query(
      `SELECT ${Q("id")} AS "id" FROM ${Q("passengers")}
       WHERE ${Q("id")}=:pid AND ${Q("flightId")}=:id`,
      { replacements: { pid, id } }
    );
    if (!chk[0]) return res.status(404).json({ message: "Passager introuvable" });

    await sequelize.query(`DELETE FROM ${Q("passengers")} WHERE ${Q("id")} = :pid`, { replacements: { pid } });
    res.json({ message: "Retiré" });
  } catch (e) {
    logError("DELETE /:id/passagers/:pid", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ========== GET /api/vols/:id/export.csv ========== */
router.get("/:id/export.csv", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await sequelize.query(
      `SELECT ${["id","code","company","fromCode","fromDate","toCode","toDate","duration"].map(c => `${Q(c)} AS "${c}"`).join(", ")}
       FROM ${Q("flights")} WHERE ${Q("id")} = :id`,
      { replacements: { id } }
    );
    const f = rows[0];
    if (!f) return res.status(404).json({ message: "Vol introuvable" });

    const [pax] = await sequelize.query(
      `SELECT ${["fullname","passport","seat"].map(c => `${Q(c)} AS "${c}"`).join(", ")}
       FROM ${Q("passengers")} WHERE ${Q("flightId")} = :id ORDER BY ${Q("id")} ASC`,
      { replacements: { id } }
    );

    const lines = [
      ["Vol", f.code],
      ["Compagnie", f.company],
      ["Départ", `${f.fromCode} - ${labelDate(f.fromDate)}`],
      ["Arrivée", `${f.toCode} - ${labelDate(f.toDate)}`],
      [],
      ["#", "Nom", "Passeport", "Siège"],
      ...pax.map((p, i) => [String(i + 1), p.fullname, p.passport || "", p.seat || ""]),
    ];
    const csv = lines.map((r) => r.map(csvEscape).join(",")).join("\n");
    const buff = Buffer.from("\uFEFF" + csv, "utf8"); // BOM UTF-8

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="passagers_${f.code}.csv"`);
    res.send(buff);
  } catch (e) {
    logError("GET /:id/export.csv", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
