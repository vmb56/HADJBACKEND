// backend/routes/vols.js
const express = require("express");
const router = express.Router();

const { query } = require("../db");

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

// colonnes choisies
const FLIGHT_SELECT = `
  id,
  code,
  company,
  fromCode,
  fromDate,
  toCode,
  toDate,
  duration,
  createdAt,
  updatedAt
`;
const PASSENGER_SELECT = `
  id,
  fullname,
  seat,
  passport,
  photoUrl,
  flightId
`;

// Petit utilitaire de log propre (diagnostic 500)
function logError(where, e) {
  // eslint-disable-next-line no-console
  console.error(`[vols] ${where}:`, e && (e.stack || e.message || e));
}

/* ============== GET /api/vols ============== */
router.get("/", async (_req, res) => {
  try {
    const flightsRes = await query(
      `
      SELECT ${FLIGHT_SELECT}
      FROM flights
      ORDER BY createdAt DESC
      `
    );
    const flights = flightsRes.rows || [];
    if (!flights.length) return res.json({ items: [] });

    const ids = flights.map((f) => f.id);
    const placeholders = ids.map(() => "?").join(",");

    const passengersRes = await query(
      `
      SELECT ${PASSENGER_SELECT}
      FROM passengers
      WHERE flightId IN (${placeholders})
      `,
      ids
    );
    const passengers = passengersRes.rows || [];

    const grouped = new Map();
    flights.forEach((f) => grouped.set(f.id, []));
    passengers.forEach((p) => {
      const arr = grouped.get(p.flightId);
      if (arr) {
        arr.push({
          id: p.id,
          fullname: p.fullname,
          seat: p.seat,
          passport: p.passport,
          photoUrl: p.photoUrl,
        });
      }
    });

    const items = flights.map((f) => ({
      id: f.id,
      code: f.code,
      company: f.company,
      from: { code: f.fromCode, date: f.fromDate },
      to: { code: f.toCode, date: f.toDate },
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
    if (
      !code ||
      !company ||
      !from?.code ||
      !from?.date ||
      !to?.code ||
      !to?.date ||
      !duration
    ) {
      return res
        .status(400)
        .json({ message: "Champs requis manquants." });
    }

    const fromDateObj = toDate(from.date);
    const toDateObj = toDate(to.date);

    const payload = {
      code: normCode(code),
      company: String(company).trim(),
      fromCode: String(from.code).trim().toUpperCase(),
      fromDate: fromDateObj,
      toCode: String(to.code).trim().toUpperCase(),
      toDate: toDateObj,
      duration: String(duration).trim(),
    };

    if (!validIATA(payload.fromCode) || !validIATA(payload.toCode)) {
      return res.status(400).json({
        message: "Codes IATA invalides (ex: DSS, JED).",
      });
    }
    if (
      !payload.fromDate ||
      !payload.toDate ||
      payload.toDate <= payload.fromDate
    ) {
      return res.status(400).json({
        message: "L’arrivée doit être postérieure au départ.",
      });
    }

    const fromDateIso = payload.fromDate.toISOString();
    const toDateIso = payload.toDate.toISOString();

    const insertRes = await query(
      `
      INSERT INTO flights (
        code,
        company,
        fromCode,
        fromDate,
        toCode,
        toDate,
        duration,
        createdAt,
        updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING ${FLIGHT_SELECT}
      `,
      [
        payload.code,
        payload.company,
        payload.fromCode,
        fromDateIso,
        payload.toCode,
        toDateIso,
        payload.duration,
      ]
    );

    const f = insertRes.rows?.[0];
    if (!f) {
      return res
        .status(500)
        .json({ message: "Insertion échouée." });
    }

    res.status(201).json({
      id: f.id,
      code: f.code,
      company: f.company,
      from: { code: f.fromCode, date: f.fromDate },
      to: { code: f.toCode, date: f.toDate },
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
    if (
      !code ||
      !company ||
      !from?.code ||
      !from?.date ||
      !to?.code ||
      !to?.date ||
      !duration
    ) {
      return res
        .status(400)
        .json({ message: "Champs requis manquants." });
    }

    const fromDateObj = toDate(from.date);
    const toDateObj = toDate(to.date);

    const updated = {
      id,
      code: normCode(code),
      company: String(company).trim(),
      fromCode: String(from.code).trim().toUpperCase(),
      fromDate: fromDateObj,
      toCode: String(to.code).trim().toUpperCase(),
      toDate: toDateObj,
      duration: String(duration).trim(),
    };

    if (!validIATA(updated.fromCode) || !validIATA(updated.toCode)) {
      return res.status(400).json({
        message: "Codes IATA invalides (ex: DSS, JED).",
      });
    }
    if (
      !updated.fromDate ||
      !updated.toDate ||
      updated.toDate <= updated.fromDate
    ) {
      return res.status(400).json({
        message: "L’arrivée doit être postérieure au départ.",
      });
    }

    // existence du vol
    const existsRes = await query(
      `SELECT id FROM flights WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!existsRes.rows?.[0]) {
      return res
        .status(404)
        .json({ message: "Vol introuvable" });
    }

    const fromDateIso = updated.fromDate.toISOString();
    const toDateIso = updated.toDate.toISOString();

    await query(
      `
      UPDATE flights
      SET
        code = ?,
        company = ?,
        fromCode = ?,
        fromDate = ?,
        toCode = ?,
        toDate = ?,
        duration = ?,
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        updated.code,
        updated.company,
        updated.fromCode,
        fromDateIso,
        updated.toCode,
        toDateIso,
        updated.duration,
        id,
      ]
    );

    // Recharger vol
    const flightRes = await query(
      `
      SELECT ${FLIGHT_SELECT}
      FROM flights
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );
    const f = flightRes.rows?.[0];
    if (!f) {
      return res
        .status(404)
        .json({ message: "Vol introuvable après MAJ" });
    }

    const paxRes = await query(
      `
      SELECT id, fullname, seat, passport, photoUrl, flightId
      FROM passengers
      WHERE flightId = ?
      ORDER BY id ASC
      `,
      [id]
    );
    const pax = paxRes.rows || [];

    res.json({
      id: f.id,
      code: f.code,
      company: f.company,
      from: { code: f.fromCode, date: f.fromDate },
      to: { code: f.toCode, date: f.toDate },
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
    await query(`DELETE FROM passengers WHERE flightId = ?`, [id]);
    await query(`DELETE FROM flights WHERE id = ?`, [id]);
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
    if (!fullname) {
      return res.status(400).json({ message: "Nom requis" });
    }

    // vol existe ?
    const existsRes = await query(
      `SELECT id FROM flights WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!existsRes.rows?.[0]) {
      return res
        .status(404)
        .json({ message: "Vol introuvable" });
    }

    const seatNorm = String(seat || "").trim().toUpperCase();
    if (seatNorm) {
      const takenRes = await query(
        `
        SELECT 1 AS t
        FROM passengers
        WHERE flightId = ? AND UPPER(seat) = ?
        LIMIT 1
        `,
        [id, seatNorm]
      );
      if (takenRes.rows?.[0]) {
        return res
          .status(409)
          .json({ message: `Siège ${seatNorm} déjà attribué.` });
      }
    }

    const insertRes = await query(
      `
      INSERT INTO passengers (
        fullname,
        seat,
        passport,
        photoUrl,
        flightId,
        createdAt,
        updatedAt
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, fullname, seat, passport, photoUrl, flightId
      `,
      [
        String(fullname).trim(),
        seatNorm || "—",
        String(passport || "").trim(),
        String(photoUrl || "").trim(),
        id,
      ]
    );

    const row = insertRes.rows?.[0];
    if (!row) {
      return res
        .status(500)
        .json({ message: "Insertion échouée." });
    }

    res.status(201).json(row);
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

    const chkRes = await query(
      `
      SELECT id
      FROM passengers
      WHERE id = ? AND flightId = ?
      LIMIT 1
      `,
      [pid, id]
    );
    if (!chkRes.rows?.[0]) {
      return res
        .status(404)
        .json({ message: "Passager introuvable" });
    }

    await query(`DELETE FROM passengers WHERE id = ?`, [pid]);
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

    const flightRes = await query(
      `
      SELECT
        id,
        code,
        company,
        fromCode,
        fromDate,
        toCode,
        toDate,
        duration
      FROM flights
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );
    const f = flightRes.rows?.[0];
    if (!f) {
      return res
        .status(404)
        .json({ message: "Vol introuvable" });
    }

    const paxRes = await query(
      `
      SELECT fullname, passport, seat
      FROM passengers
      WHERE flightId = ?
      ORDER BY id ASC
      `,
      [id]
    );
    const pax = paxRes.rows || [];

    const lines = [
      ["Vol", f.code],
      ["Compagnie", f.company],
      ["Départ", `${f.fromCode} - ${labelDate(f.fromDate)}`],
      ["Arrivée", `${f.toCode} - ${labelDate(f.toDate)}`],
      [],
      ["#", "Nom", "Passeport", "Siège"],
      ...pax.map((p, i) => [
        String(i + 1),
        p.fullname,
        p.passport || "",
        p.seat || "",
      ]),
    ];

    const csv = lines.map((r) => r.map(csvEscape).join(",")).join("\n");
    const buff = Buffer.from("\uFEFF" + csv, "utf8"); // BOM UTF-8

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="passagers_${f.code}.csv"`
    );
    res.send(buff);
  } catch (e) {
    logError("GET /:id/export.csv", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
