// backend/routes/chat.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { query } = require("../db"); // ⬅️ Turso / libSQL

const router = express.Router();

/* ========= constantes domaine ========= */
const CHANNELS = ["intra", "encadreurs"]; // même logique que le front
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "chat");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ========= stockage fichiers ========= */
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

/* ========= helpers fichiers/sql ========= */
const toPublicPath = (filename) =>
  filename ? `/uploads/chat/${filename}` : null;

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
function inferTypeFromMimetype(mime = "") {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}
function safeJsonParse(v, fallback = []) {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

/* ========= SSE (temps réel) ========= */
let sseClients = []; // { id, res, channel }
function sseBroadcast(channel, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const c of sseClients) {
    if (!channel || c.channel === channel) {
      try {
        c.res.write(data);
      } catch {
        /* socket peut être fermée */
      }
    }
  }
}
// keepalive pour éviter timeouts proxy (25s)
setInterval(() => {
  for (const c of sseClients) {
    try {
      c.res.write(`event: ping\ndata: {}\n\n`);
    } catch {}
  }
}, 25000);

/* ============================================================================
  GET /api/chat/channels — liste des canaux
============================================================================ */
router.get("/channels", (_req, res) => {
  res.json({ channels: CHANNELS });
});

/* ============================================================================
  GET /api/chat/stream — flux temps réel par canal (SSE)
  Query:
    - channel= intra|encadreurs (obligatoire)
============================================================================ */
router.get("/stream", (req, res) => {
  const channel = String(req.query.channel || "").trim();
  if (!CHANNELS.includes(channel)) {
    return res.status(400).json({ message: "Paramètre 'channel' invalide." });
  }

  // entêtes SSE
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.flushHeaders?.();

  const client = { id: Date.now() + Math.random(), res, channel };
  sseClients.push(client);

  // message d’accueil
  try {
    res.write(`event: ready\ndata: {"ok":true}\n\n`);
  } catch {}

  req.on("close", () => {
    sseClients = sseClients.filter((c) => c !== client);
    try {
      res.end();
    } catch {}
  });
});

/* ============================================================================
  GET /api/chat/messages — liste (channel requis, pagination/filtre facultatifs)
  Query:
    - channel= intra|encadreurs (obligatoire)
    - limit=50 (defaut 50, max 200)
    - afterId=123 (retourne > afterId, pratique pour polling)
    - search=... (facultatif: texte/author_name)
============================================================================ */
router.get("/messages", async (req, res) => {
  try {
    const channel = String(req.query.channel || "").trim();
    if (!CHANNELS.includes(channel)) {
      return res.status(400).json({ message: "Paramètre 'channel' invalide." });
    }
    const limit = Math.min(
      parseInt(req.query.limit ?? "50", 10) || 50,
      200
    );
    const afterId = req.query.afterId ? Number(req.query.afterId) : null;
    const search = String(req.query.search || "").trim();

    const params = [channel];
    const whereParts = ["channel = ?", "deleted_at IS NULL"];

    if (afterId) {
      whereParts.push("id > ?");
      params.push(afterId);
    }

    if (search) {
      // fallback LIKE
      whereParts.push("(author_name LIKE ? OR text LIKE ?)");
      const p = `%${search}%`;
      params.push(p, p);
    }

    const sql = `
      SELECT
        id, channel, author_id, author_name, text, reply_to_id,
        attachments_json, edited_at, deleted_at, created_at, updated_at
      FROM chat_messages
      WHERE ${whereParts.join(" AND ")}
      ORDER BY id DESC
      LIMIT ?
    `;

    const result = await query(sql, [...params, limit]);
    const rows = result.rows || [];

    res.json({ items: rows.slice().reverse(), total: rows.length });
  } catch (err) {
    console.error("❌ GET /api/chat/messages:", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ============================================================================
  GET /api/chat/messages/:id — lecture d’un message
============================================================================ */
router.get("/messages/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id invalide" });

    const result = await query(
      `
      SELECT
        id, channel, author_id, author_name, text, reply_to_id,
        attachments_json, edited_at, deleted_at, created_at, updated_at
      FROM chat_messages
      WHERE id = ?
      `,
      [id]
    );
    const row = result.rows?.[0];
    if (!row) return res.status(404).json({ message: "Introuvable" });
    res.json(row);
  } catch (err) {
    console.error("❌ GET /api/chat/messages/:id:", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ============================================================================
  POST /api/chat/messages — création (multipart **ou** JSON)
  Champs:
    - channel (obligatoire)
    - authorName (obligatoire), authorId (facultatif)
    - text (facultatif si fichiers présents)
    - replyToId (facultatif)
    - files[] (0..10) en multipart
============================================================================ */
router.post("/messages", upload.array("files", 10), async (req, res) => {
  try {
    const isMultipart =
      req.is("multipart/form-data") || (req.files && req.files.length > 0);
    const b = isMultipart ? req.body : req.body || {};

    const channel = String(b.channel || "").trim();
    if (!CHANNELS.includes(channel)) {
      return res.status(400).json({ message: "Channel invalide." });
    }

    const authorName = String(b.authorName || "").trim();
    if (!authorName) {
      return res.status(400).json({ message: "authorName requis." });
    }
    const authorId = b.authorId ? String(b.authorId) : null;

    const text = (b.text ?? "").toString().trim();
    const replyToId = b.replyToId ? Number(b.replyToId) : null;

    // Attachements (si multipart)
    let attachments = [];
    if (isMultipart && req.files?.length) {
      attachments = req.files.map((f) => ({
        id: path.parse(f.filename).name,
        name: f.originalname,
        type: inferTypeFromMimetype(f.mimetype),
        url: toPublicPath(f.filename),
      }));
    }

    if (!text && attachments.length === 0) {
      return res.status(400).json({ message: "Message vide." });
    }

    const insertResult = await query(
      `
      INSERT INTO chat_messages
        (channel, author_id, author_name, text, reply_to_id, attachments_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING
        id, channel, author_id, author_name, text, reply_to_id,
        attachments_json, edited_at, deleted_at, created_at, updated_at
      `,
      [
        channel,
        authorId,
        authorName,
        text || null,
        replyToId || null,
        attachments.length ? JSON.stringify(attachments) : null,
      ]
    );

    const row = insertResult.rows?.[0];

    // émettre SSE (message:new)
    if (row) sseBroadcast(channel, { type: "message:new", item: row });

    return res.status(201).json({ item: row });
  } catch (err) {
    console.error("❌ POST /api/chat/messages:", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ============================================================================
  PUT /api/chat/messages/:id — mise à jour (multipart **ou** JSON)
  - text facultatif (si fourni => modifié)
  - possibilité d'ajouter des fichiers en plus
  - replaceAttachments=true pour remplacer (et supprimer) les anciens
============================================================================ */
router.put("/messages/:id", upload.array("files", 10), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "id invalide" });

    const isMultipart =
      req.is("multipart/form-data") || (req.files && req.files.length > 0);
    const b = isMultipart ? req.body : req.body || {};

    const text =
      typeof b.text === "string" ? b.text.trim() : undefined; // undefined = ne pas toucher
    const replaceAttachments =
      String(b.replaceAttachments || "").toLowerCase() === "true";

    // Récup message actuel
    const currentRes = await query(
      `SELECT id, channel, attachments_json, deleted_at FROM chat_messages WHERE id = ?`,
      [id]
    );
    const current = currentRes.rows?.[0];
    if (!current) return res.status(404).json({ message: "Introuvable" });
    if (current.deleted_at) {
      return res.status(400).json({ message: "Message supprimé." });
    }

    const channel = current.channel;

    // Construire nouveaux attachments
    let newAttachments = [];
    if (isMultipart && req.files?.length) {
      newAttachments = req.files.map((f) => ({
        id: path.parse(f.filename).name,
        name: f.originalname,
        type: inferTypeFromMimetype(f.mimetype),
        url: toPublicPath(f.filename),
      }));
    }

    const oldAttachments = safeJsonParse(current.attachments_json, []);
    let finalAttachments;

    if (replaceAttachments) {
      // supprimer physiquement les anciens fichiers
      oldAttachments.forEach((a) => removeFileIfExists(a?.url));
      finalAttachments = newAttachments;
    } else {
      finalAttachments = [...oldAttachments, ...newAttachments];
    }

    const sets = [];
    const params = [];

    if (text !== undefined) {
      sets.push("text = ?");
      params.push(text || null);
    }
    sets.push("attachments_json = ?");
    params.push(
      finalAttachments.length ? JSON.stringify(finalAttachments) : null
    );
    sets.push("edited_at = CURRENT_TIMESTAMP");
    sets.push("updated_at = CURRENT_TIMESTAMP");

    params.push(id);

    await query(
      `UPDATE chat_messages SET ${sets.join(", ")} WHERE id = ?`,
      params
    );

    const rowRes = await query(
      `
      SELECT
        id, channel, author_id, author_name, text, reply_to_id,
        attachments_json, edited_at, deleted_at, created_at, updated_at
      FROM chat_messages
      WHERE id = ?
      `,
      [id]
    );
    const row = rowRes.rows?.[0];

    // émettre SSE (message:update)
    if (row) sseBroadcast(channel, { type: "message:update", item: row });

    return res.json({
      message: "Mise à jour effectuée",
      item: row || null,
    });
  } catch (err) {
    console.error("❌ PUT /api/chat/messages/:id:", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

/* ============================================================================
  DELETE /api/chat/messages/:id — soft delete + suppression des fichiers
============================================================================ */
router.delete("/messages/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "id invalide" });
    }

    const rowRes = await query(
      `
      SELECT channel, attachments_json, deleted_at
      FROM chat_messages
      WHERE id = ?
      `,
      [id]
    );
    const row = rowRes.rows?.[0];

    if (!row) {
      return res.status(404).json({ message: "Introuvable" });
    }
    if (row.deleted_at) {
      return res.status(400).json({ message: "Déjà supprimé." });
    }

    const updateRes = await query(
      `
      UPDATE chat_messages
      SET deleted_at = CURRENT_TIMESTAMP,
          attachments_json = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [id]
    );

    // nettoyage fichiers hors DB
    const attachments = safeJsonParse(row.attachments_json, []);
    attachments.forEach((a) => removeFileIfExists(a?.url));

    // émettre SSE (message:delete)
    if (row.channel) {
      sseBroadcast(row.channel, { type: "message:delete", id });
    }

    const affected =
      typeof updateRes.rowsAffected === "number"
        ? updateRes.rowsAffected
        : 0;

    res.json({ message: "Supprimé", affectedRows: affected });
  } catch (err) {
    console.error("❌ DELETE /api/chat/messages/:id:", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

module.exports = router;
