// backend/routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db"); // ⬅️ Turso (libSQL)
const { signJwt } = require("../utils/jwt");

const router = express.Router();

/** POST /api/auth/register */
router.post("/register", async (req, res) => {
  try {
    const { name, email, role = "Agent", password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }

    const emailNorm = email.toLowerCase().trim();

    // 🔍 Vérifier si l'email existe déjà
    const existsResult = await query(
      "SELECT id, name, email, role FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
      [emailNorm]
    );

    const existingUser = existsResult.rows[0];
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Un compte existe déjà avec cet email" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // 🆕 Créer l'utilisateur
    const insertResult = await query(
      `
      INSERT INTO users (name, email, role, passwordHash, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, name, email, role
      `,
      [name.trim(), emailNorm, role, passwordHash]
    );

    const user = insertResult.rows[0];

    const token = signJwt({ id: user.id, email: user.email, role: user.role });

    return res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (e) {
    console.error("REGISTER_ERROR:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/** POST /api/auth/login */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email et mot de passe requis" });
    }

    const emailNorm = email.toLowerCase().trim();

    // 🔍 Récupérer l'utilisateur par email
    const result = await query(
      `
      SELECT id, name, email, role, passwordHash
      FROM users
      WHERE LOWER(email) = LOWER(?)
      LIMIT 1
      `,
      [emailNorm]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    // 🕒 Mettre à jour la date de dernière connexion
    await query(
      "UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
      [user.id]
    );

    const token = signJwt({ id: user.id, email: user.email, role: user.role });

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (e) {
    console.error("LOGIN_ERROR:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

module.exports = router;
