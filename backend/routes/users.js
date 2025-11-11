// backend/routes/users.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { requireAuth, requireRole } = require("../middleware/auth");
const { User } = require("../models");
const { Op } = require("sequelize");

const router = express.Router();

/* ---------- LISTE ---------- */
router.get(
  "/",
  requireAuth,
  requireRole("Admin", "Superviseur", "Agent"),
  async (req, res) => {
    try {
      const search = (req.query.search || "").trim();

      // MySQL/SQLite: Op.like ; Postgres: Op.iLike
      const likeOp =
        (User.sequelize?.getDialect?.() || "").toLowerCase() === "postgres"
          ? Op.iLike
          : Op.like;

      const where = search
        ? {
            [Op.or]: [
              { name: { [likeOp]: `%${search}%` } },
              { email: { [likeOp]: `%${search}%` } },
              { role: { [likeOp]: `%${search}%` } },
            ],
          }
        : {};

      const users = await User.findAll({ where, order: [["createdAt", "DESC"]] });

      res.json({
        items: users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          lastLoginAt: u.lastLoginAt || u.lastLogin || null,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
        total: users.length,
      });
    } catch (err) {
      res.status(500).json({ message: "Erreur serveur", detail: err.message });
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
        return res.status(400).json({ message: "Le nom est obligatoire" });
      }
      const emailNorm = (email || "").toString().trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(emailNorm)) {
        return res.status(400).json({ message: "Email invalide" });
      }
      const allowed = ["Admin", "Superviseur", "Agent"];
      if (!allowed.includes(role)) {
        return res.status(400).json({ message: "Rôle invalide" });
      }

      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

      // email unique ?
      const exists = await User.findOne({
        where: {
          email: emailNorm,
          id: { [Op.ne]: user.id },
        },
      });
      if (exists) return res.status(409).json({ message: "Email déjà utilisé" });

      user.name = name.trim();
      user.email = emailNorm;
      user.role = role;

      // mot de passe optionnel
      if (typeof password === "string" && password.length > 0) {
        if (password.length < 8) {
          return res.status(400).json({ message: "Mot de passe trop court (min 8 caractères)." });
        }
        const hash = await bcrypt.hash(password, 10);
        user.passwordHash = hash;
      }

      await user.save();

      return res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        lastLoginAt: user.lastLoginAt || null,
        updatedAt: user.updatedAt,
      });
    } catch (err) {
      res.status(500).json({ message: "Erreur serveur", detail: err.message });
    }
  }
);

/* ---------- MISE À JOUR DU MOT DE PASSE (endpoint dédié) ---------- */
/**
 * PUT /api/users/:id/password
 * Body:
 *  - newPassword (obligatoire)
 *  - oldPassword (obligatoire si l’appelant N’EST PAS Admin/Superviseur)
 *
 * Règles:
 *  - Admin/Superviseur: peut changer le mot de passe de n’importe qui sans oldPassword
 *  - Autre (Agent): ne peut changer QUE son propre mot de passe, et doit fournir oldPassword correct
 */
router.put(
  "/:id/password",
  requireAuth,
  async (req, res) => {
    try {
      const id = String(req.params.id);
      const { newPassword, oldPassword } = req.body || {};

      if (!newPassword || String(newPassword).length < 8) {
        return res.status(400).json({ message: "Nouveau mot de passe invalide (min 8 caractères)." });
      }

      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

      const caller = req.user; // supposé injecté par requireAuth
      const isAdminOrSup = ["Admin", "Superviseur"].includes(caller?.role);
      const isSelf = String(caller?.id) === String(user.id);

      if (!isAdminOrSup && !isSelf) {
        return res.status(403).json({ message: "Accès refusé." });
      }

      // Si ce n’est pas Admin/Superviseur, on exige l’ancien mot de passe
      if (!isAdminOrSup) {
        if (!oldPassword || !user.passwordHash) {
          return res.status(400).json({ message: "Ancien mot de passe requis." });
        }
        const ok = await bcrypt.compare(String(oldPassword), String(user.passwordHash));
        if (!ok) {
          return res.status(400).json({ message: "Ancien mot de passe incorrect." });
        }
      }

      const hash = await bcrypt.hash(String(newPassword), 10);
      user.passwordHash = hash;
      await user.save();

      return res.json({ message: "Mot de passe mis à jour." });
    } catch (err) {
      res.status(500).json({ message: "Erreur serveur", detail: err.message });
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
      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });

      await user.destroy();
      return res.status(200).json({ message: "Supprimé" });
    } catch (err) {
      res.status(500).json({ message: "Erreur serveur", detail: err.message });
    }
  }
);

module.exports = router;
