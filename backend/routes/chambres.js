// backend/routes/chambres.js
const express = require("express");
const router = express.Router();
const { sequelize } = require("../db");

/* ================= Helpers ================= */
function isPg() {
  return (sequelize.getDialect?.() || "").toLowerCase() === "postgres";
}
const Q = (c) => (isPg() ? `"${c}"` : c);

function logError(where, e) {
  console.error(`[chambres] ${where}:`, e && (e.stack || e.message || e));
  if (e?.parent?.sql) console.error("[SQL]", e.parent.sql);
  if (e?.parent?.parameters) console.error("[Params]", e.parent.parameters);
}

function normalizeRoomPayload(b = {}) {
  return {
    hotel: String(b.hotel || "").trim(),
    city: String(b.city || "").trim(),
    type: (b.type || "double").trim().toLowerCase(), // double/triple/quadruple…
    capacity: Math.max(1, Number(b.capacity) || 1),
  };
}

/* ================= Colonnes ================= */
const roomCols = [
  "id", "hotel", "city", "type", "capacity", "createdAt", "updatedAt",
].map(k => `${Q(k)} AS "${k}"`).join(", ");

const occCols = [
  "id", "name", "passport", "photoUrl", "roomId", "createdAt", "updatedAt",
].map(k => `${Q(k)} AS "${k}"`).join(", ");

/* =========== GET /api/chambres =========== */
router.get("/", async (_req, res) => {
  try {
    const [rooms] = await sequelize.query(
      `SELECT ${roomCols} FROM ${Q("rooms")} ORDER BY ${Q("createdAt")} DESC`
    );
    if (!rooms.length) return res.json({ items: [] });

    const ids = rooms.map(r => r.id);
    const placeholders = ids.map(() => "?").join(",");

    const [occs] = await sequelize.query(
      `SELECT ${occCols}
       FROM ${Q("room_occupants")}
       WHERE ${Q("roomId")} IN (${placeholders})
       ORDER BY ${Q("id")} ASC`,
      { replacements: ids }
    );

    const grouped = new Map();
    rooms.forEach(r => grouped.set(r.id, []));
    occs.forEach(o => {
      const arr = grouped.get(o.roomId);
      if (arr) arr.push({ id: o.id, name: o.name, passport: o.passport, photoUrl: o.photoUrl });
    });

    const items = rooms.map(r => ({
      id: r.id,
      hotel: r.hotel,
      city: r.city,
      type: r.type,
      capacity: r.capacity,
      occupants: grouped.get(r.id) || [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    res.json({ items });
  } catch (e) {
    logError("GET /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* =========== POST /api/chambres =========== */
router.post("/", async (req, res) => {
  try {
    const p = normalizeRoomPayload(req.body);
    if (!p.hotel || !p.city) {
      return res.status(400).json({ message: "Champs requis manquants (hotel, city)." });
    }

    let insertedId;
    if (isPg()) {
      const [rows] = await sequelize.query(
        `INSERT INTO ${Q("rooms")} (${Q("hotel")}, ${Q("city")}, ${Q("type")}, ${Q("capacity")}, ${Q("createdAt")}, ${Q("updatedAt")})
         VALUES (:hotel, :city, :type, :capacity, NOW(), NOW())
         RETURNING ${Q("id")} AS "id"`,
        { replacements: p }
      );
      insertedId = rows[0].id;
    } else {
      const [r] = await sequelize.query(
        `INSERT INTO ${Q("rooms")} (${Q("hotel")}, ${Q("city")}, ${Q("type")}, ${Q("capacity")}, ${Q("createdAt")}, ${Q("updatedAt")})
         VALUES (:hotel, :city, :type, :capacity, NOW(), NOW())`,
        { replacements: p }
      );
      insertedId = r?.insertId;
      if (!insertedId) {
        const [rid] = await sequelize.query(`SELECT LAST_INSERT_ID() AS id`);
        insertedId = rid?.[0]?.id;
      }
    }

    const [[room]] = await sequelize.query(
      `SELECT ${roomCols} FROM ${Q("rooms")} WHERE ${Q("id")} = :id`,
      { replacements: { id: insertedId } }
    );

    res.status(201).json({
      id: room.id,
      hotel: room.hotel,
      city: room.city,
      type: room.type,
      capacity: room.capacity,
      occupants: [],
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    });
  } catch (e) {
    logError("POST /", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* =========== PUT /api/chambres/:id =========== */
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const p = normalizeRoomPayload(req.body);
    if (!p.hotel || !p.city) {
      return res.status(400).json({ message: "Champs requis manquants (hotel, city)." });
    }

    const [exists] = await sequelize.query(
      `SELECT ${Q("id")} AS "id" FROM ${Q("rooms")} WHERE ${Q("id")}=:id`,
      { replacements: { id } }
    );
    if (!exists.length) return res.status(404).json({ message: "Chambre introuvable" });

    await sequelize.query(
      `UPDATE ${Q("rooms")}
       SET ${Q("hotel")}=:hotel, ${Q("city")}=:city, ${Q("type")}=:type, ${Q("capacity")}=:capacity, ${Q("updatedAt")}=NOW()
       WHERE ${Q("id")}=:id`,
      { replacements: { id, ...p } }
    );

    const [[room]] = await sequelize.query(
      `SELECT ${roomCols} FROM ${Q("rooms")} WHERE ${Q("id")}=:id`,
      { replacements: { id } }
    );
    const [occs] = await sequelize.query(
      `SELECT ${occCols}
       FROM ${Q("room_occupants")}
       WHERE ${Q("roomId")} = :id
       ORDER BY ${Q("id")} ASC`,
      { replacements: { id } }
    );

    res.json({
      id: room.id,
      hotel: room.hotel,
      city: room.city,
      type: room.type,
      capacity: room.capacity,
      occupants: occs.map(o => ({ id: o.id, name: o.name, passport: o.passport, photoUrl: o.photoUrl })),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    });
  } catch (e) {
    logError("PUT /:id", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* =========== DELETE /api/chambres/:id =========== */
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await sequelize.query(`DELETE FROM ${Q("room_occupants")} WHERE ${Q("roomId")}=:id`, { replacements: { id } });
    await sequelize.query(`DELETE FROM ${Q("rooms")} WHERE ${Q("id")}=:id`, { replacements: { id } });
    res.json({ message: "Supprimé" });
  } catch (e) {
    logError("DELETE /:id", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* ===== POST /api/chambres/:id/occupants ===== */
router.post("/:id/occupants", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, passport, photoUrl } = req.body || {};
    if (!String(name || "").trim()) return res.status(400).json({ message: "Nom requis" });

    const [exists] = await sequelize.query(
      `SELECT ${Q("id")} AS "id" FROM ${Q("rooms")} WHERE ${Q("id")}=:id`,
      { replacements: { id } }
    );
    if (!exists[0]) return res.status(404).json({ message: "Chambre introuvable" });

    let insertedId;
    if (isPg()) {
      const [rows] = await sequelize.query(
        `INSERT INTO ${Q("room_occupants")} (${Q("name")}, ${Q("passport")}, ${Q("photoUrl")}, ${Q("roomId")}, ${Q("createdAt")}, ${Q("updatedAt")})
         VALUES (:name, :passport, :photoUrl, :roomId, NOW(), NOW())
         RETURNING ${Q("id")} AS "id"`,
        { replacements: {
            name: String(name).trim(),
            passport: String(passport || "").trim(),
            photoUrl: String(photoUrl || "").trim(),
            roomId: id,
        } }
      );
      insertedId = rows[0].id;
    } else {
      const [r] = await sequelize.query(
        `INSERT INTO ${Q("room_occupants")} (${Q("name")}, ${Q("passport")}, ${Q("photoUrl")}, ${Q("roomId")}, ${Q("createdAt")}, ${Q("updatedAt")})
         VALUES (:name, :passport, :photoUrl, :roomId, NOW(), NOW())`,
        { replacements: {
            name: String(name).trim(),
            passport: String(passport || "").trim(),
            photoUrl: String(photoUrl || "").trim(),
            roomId: id,
        } }
      );
      insertedId = r?.insertId;
      if (!insertedId) {
        const [rid] = await sequelize.query(`SELECT LAST_INSERT_ID() AS id`);
        insertedId = rid?.[0]?.id;
      }
    }

    const [[occ]] = await sequelize.query(
      `SELECT ${occCols}
       FROM ${Q("room_occupants")}
       WHERE ${Q("id")}=:oid`,
      { replacements: { oid: insertedId } }
    );

    res.status(201).json({
      id: occ.id,
      name: occ.name,
      passport: occ.passport,
      photoUrl: occ.photoUrl,
    });
  } catch (e) {
    logError("POST /:id/occupants", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

/* === DELETE /api/chambres/:id/occupants/:oid === */
router.delete("/:id/occupants/:oid", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const oid = Number(req.params.oid);

    const [chk] = await sequelize.query(
      `SELECT ${Q("id")} AS "id"
       FROM ${Q("room_occupants")}
       WHERE ${Q("id")}=:oid AND ${Q("roomId")}=:id`,
      { replacements: { oid, id } }
    );
    if (!chk[0]) return res.status(404).json({ message: "Occupant introuvable" });

    await sequelize.query(
      `DELETE FROM ${Q("room_occupants")} WHERE ${Q("id")}=:oid`,
      { replacements: { oid } }
    );
    res.json({ message: "Retiré" });
  } catch (e) {
    logError("DELETE /:id/occupants/:oid", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
