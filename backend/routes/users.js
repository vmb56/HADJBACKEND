// backend/routes/users.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { requireAuth, requireRole } = require("../middleware/auth");
const { query } = require("../db"); // ⬅️ Turso, plus de Sequelize ici

const router = express.Router();

/* ---------- LISTE ---------- */
router.get(
  "/",
  requireAuth,
  requireRole("Admin", "Superviseur", "Agent"),
  async (req, res) => {
    try {
      const search = (req.query.search || "").toString().trim().toLowerCase();

      const params = [];
      let whereSql = "";

      if (search) {
        whereSql = `
          WHERE
            LOWER(name)  LIKE ?
            OR LOWER(email) LIKE ?
            OR LOWER(role)  LIKE ?
        `;
        const p = `%${search}%`;
        params.push(p, p, p);
      }

      const result = await query(
        `
        SELECT
          id,
          name,
          email,
          role,
          lastLoginAt,
          createdAt,
          updatedAt
        FROM users
        ${whereSql}
        ORDER BY createdAt DESC
        `,
        params
      );

      const users = result.rows || [];

      res.json({
        items: users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          lastLoginAt: u.lastLoginAt || null,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
        total: users.length,
      });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Erreur serveur", detail: err.message });
    }
  }
);

/* ---------- MISE À JOUR (nom/email/role + password optionnel) ---------- */
router.put(
  "/:id",
  requireAuth,
  requireRole("Admin", "Superviseur"),
  async (req, res) => {
    try {
      const id = req.params.id;
      const { name, email, role, password } = req.body || {};

      // validations simples
      if (!name || !name.trim()) {
        return res
          .status(400)
          .json({ message: "Le nom est obligatoire" });
      }
      const emailNorm = (email || "").toString().trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(emailNorm)) {
        return res.status(400).json({ message: "Email invalide" });
      }
      const allowed = ["Admin", "Superviseur", "Agent"];
      if (!allowed.includes(role)) {
        return res.status(400).json({ message: "Rôle invalide" });
      }

      // Récupérer l'utilisateur
      const userRes = await query(
        `SELECT * FROM users WHERE id = ? LIMIT 1`,
        [id]
      );
      const user = userRes.rows?.[0];
      if (!user) {
        return res
          .status(404)
          .json({ message: "Utilisateur introuvable" });
      }

      // Vérifier unicité email
      const existsRes = await query(
        `SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1`,
        [emailNorm, id]
      );
      if (existsRes.rows?.[0]) {
        return res
          .status(409)
          .json({ message: "Email déjà utilisé" });
      }

      // Construire l'UPDATE
      const sets = ["name = ?", "email = ?", "role = ?"];
      const params = [name.trim(), emailNorm, role];

      // mot de passe optionnel
      if (typeof password === "string" && password.length > 0) {
        if (password.length < 8) {
          return res.status(400).json({
            message:
              "Mot de passe trop court (min 8 caractères).",
          });
        }
        const hash = await bcrypt.hash(password, 10);
        sets.push("passwordHash = ?");
        params.push(hash);
      }

      sets.push("updatedAt = CURRENT_TIMESTAMP");
      params.push(id);

      await query(
        `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
        params
      );

      // Relecture
      const updatedRes = await query(
        `
        SELECT id, name, email, role, lastLoginAt, createdAt, updatedAt
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
        [id]
      );
      const updated = updatedRes.rows?.[0];

      return res.json({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        lastLoginAt: updated.lastLoginAt || null,
        updatedAt: updated.updatedAt,
      });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Erreur serveur", detail: err.message });
    }
  }
);

/* ---------- MISE À JOUR DU MOT DE PASSE (endpoint dédié) ---------- */
/**
 * PUT /api/users/:id/password
 * Body:
 *  - newPassword (obligatoire)
 *  - oldPassword (obligatoire si l’appelant N’EST PAS Admin/Superviseur)
 */
router.put(
  "/:id/password",
  requireAuth,
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const { newPassword, oldPassword } = req.body || {};

      if (!newPassword || String(newPassword).length < 8) {
        return res.status(400).json({
          message:
            "Nouveau mot de passe invalide (min 8 caractères).",
        });
      }

      const userRes = await query(
        `SELECT * FROM users WHERE id = ? LIMIT 1`,
        [id]
      );
      const user = userRes.rows?.[0];
      if (!user) {
        return res
          .status(404)
          .json({ message: "Utilisateur introuvable" });
      }

      const caller = req.user; // injecté par requireAuth
      const isAdminOrSup = ["Admin", "Superviseur"].includes(
        caller?.role
      );
      const isSelf = String(caller?.id) === String(user.id);

      if (!isAdminOrSup && !isSelf) {
        return res.status(403).json({ message: "Accès refusé." });
      }

      // Si ce n’est pas Admin/Superviseur, on exige l'ancien mot de passe
      if (!isAdminOrSup) {
        if (!oldPassword || !user.passwordHash) {
          return res.status(400).json({
            message: "Ancien mot de passe requis.",
          });
        }
        const ok = await bcrypt.compare(
          String(oldPassword),
          String(user.passwordHash)
        );
        if (!ok) {
          return res.status(400).json({
            message: "Ancien mot de passe incorrect.",
          });
        }
      }

      const hash = await bcrypt.hash(String(newPassword), 10);
      await query(
        `
        UPDATE users
        SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [hash, id]
      );

      return res.json({ message: "Mot de passe mis à jour." });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Erreur serveur", detail: err.message });
    }
  }
);

/* ---------- SUPPRESSION ---------- */
router.delete(
  "/:id",
  requireAuth,
  requireRole("Admin"),
  async (req, res) => {
    try {
      const id = req.params.id;

      const checkRes = await query(
        `SELECT id FROM users WHERE id = ? LIMIT 1`,
        [id]
      );
      if (!checkRes.rows?.[0]) {
        return res
          .status(404)
          .json({ message: "Utilisateur introuvable" });
      }

      await query(`DELETE FROM users WHERE id = ?`, [id]);

      return res.status(200).json({ message: "Supprimé" });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Erreur serveur", detail: err.message });
    }
  }
);

module.exports = router;
