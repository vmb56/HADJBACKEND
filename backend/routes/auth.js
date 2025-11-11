// backend/routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { User } = require("../models");
const { signJwt } = require("../utils/jwt");

const router = express.Router();

/** POST /api/auth/register */
router.post("/register", async (req, res) => {
  try {
    const { name, email, role = "Agent", password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Champs requis manquants" });
    }

    const exists = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (exists) return res.status(409).json({ message: "Un compte existe déjà avec cet email" });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      role,
      passwordHash
    });

    const token = signJwt({ id: user.id, email: user.email, role: user.role });

    return res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token
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
    if (!email || !password)
      return res.status(400).json({ message: "Email et mot de passe requis" });

    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user) return res.status(401).json({ message: "Identifiants invalides" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Identifiants invalides" });

    user.lastLoginAt = new Date();
    await user.save();

    const token = signJwt({ id: user.id, email: user.email, role: user.role });

    return res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token
    });
  } catch (e) {
    console.error("LOGIN_ERROR:", e);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

module.exports = router;
