// backend/routes/chambres.js
const express = require("express");
const router = express.Router();
const { query } = require("../db"); // ⬅️ Turso / libSQL

/* ================= Helpers ================= */

function logError(where, e) {
  console.error(`[chambres] ${where}:`, e && (e.stack || e.message || e));
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

const roomCols =
  'id, hotel, city, type, capacity, createdAt, updatedAt';

const occCols =
  'id, name, passport, photoUrl, roomId, createdAt, updatedAt';

/* =========== GET /api/chambres =========== */
router.get("/", async (_req, res) => {
  try {
    const roomsResult = await query(
      `SELECT ${roomCols} FROM rooms ORDER BY createdAt DESC`
    );
    const rooms = roomsResult.rows || [];

    if (!rooms.length) return res.json({ items: [] });

    const ids = rooms.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");

    const occsResult = await query(
      `SELECT ${occCols}
       FROM room_occupants
       WHERE roomId IN (${placeholders})
       ORDER BY id ASC`,
      ids
    );
    const occs = occsResult.rows || [];

    const grouped = new Map();
    rooms.forEach((r) => grouped.set(r.id, []));
    occs.forEach((o) => {
      const arr = grouped.get(o.roomId);
      if (arr) {
        arr.push({
          id: o.id,
          name: o.name,
          passport: o.passport,
          photoUrl: o.photoUrl,
        });
      }
    });

    const items = rooms.map((r) => ({
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
      return res
        .status(400)
        .json({ message: "Champs requis manquants (hotel, city)." });
    }

    const insertResult = await query(
      `
      INSERT INTO rooms (hotel, city, type, capacity, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING ${roomCols}
      `,
      [p.hotel, p.city, p.type, p.capacity]
    );

    const room = insertResult.rows?.[0];
    if (!room) {
      throw new Error("Insertion chambre échouée");
    }

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
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "ID invalide" });
    }

    const p = normalizeRoomPayload(req.body);
    if (!p.hotel || !p.city) {
      return res
        .status(400)
        .json({ message: "Champs requis manquants (hotel, city)." });
    }

    const existsRes = await query(
      `SELECT id FROM rooms WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!existsRes.rows?.length) {
      return res.status(404).json({ message: "Chambre introuvable" });
    }

    await query(
      `
      UPDATE rooms
      SET hotel = ?, city = ?, type = ?, capacity = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [p.hotel, p.city, p.type, p.capacity, id]
    );

    const roomRes = await query(
      `SELECT ${roomCols} FROM rooms WHERE id = ? LIMIT 1`,
      [id]
    );
    const room = roomRes.rows?.[0];

    const occsRes = await query(
      `
      SELECT ${occCols}
      FROM room_occupants
      WHERE roomId = ?
      ORDER BY id ASC
      `,
      [id]
    );

    const occs = occsRes.rows || [];

    res.json({
      id: room.id,
      hotel: room.hotel,
      city: room.city,
      type: room.type,
      capacity: room.capacity,
      occupants: occs.map((o) => ({
        id: o.id,
        name: o.name,
        passport: o.passport,
        photoUrl: o.photoUrl,
      })),
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
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "ID invalide" });
    }

    await query(
      `DELETE FROM room_occupants WHERE roomId = ?`,
      [id]
    );
    await query(
      `DELETE FROM rooms WHERE id = ?`,
      [id]
    );

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
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "ID invalide" });
    }

    const { name, passport, photoUrl } = req.body || {};
    if (!String(name || "").trim()) {
      return res.status(400).json({ message: "Nom requis" });
    }

    const existsRes = await query(
      `SELECT id FROM rooms WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!existsRes.rows?.length) {
      return res.status(404).json({ message: "Chambre introuvable" });
    }

    const insertRes = await query(
      `
      INSERT INTO room_occupants (name, passport, photoUrl, roomId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING ${occCols}
      `,
      [
        String(name).trim(),
        String(passport || "").trim(),
        String(photoUrl || "").trim(),
        id,
      ]
    );

    const occ = insertRes.rows?.[0];
    if (!occ) {
      throw new Error("Insertion occupant échouée");
    }

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
    if (!id || !oid || Number.isNaN(id) || Number.isNaN(oid)) {
      return res.status(400).json({ message: "ID invalide" });
    }

    const chkRes = await query(
      `
      SELECT id
      FROM room_occupants
      WHERE id = ? AND roomId = ?
      LIMIT 1
      `,
      [oid, id]
    );
    if (!chkRes.rows?.length) {
      return res.status(404).json({ message: "Occupant introuvable" });
    }

    await query(
      `DELETE FROM room_occupants WHERE id = ?`,
      [oid]
    );

    res.json({ message: "Retiré" });
  } catch (e) {
    logError("DELETE /:id/occupants/:oid", e);
    res.status(500).json({ message: "Erreur serveur", detail: e.message });
  }
});

module.exports = router;
