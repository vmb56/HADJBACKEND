// backend/utils/jwt.js
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const JWT_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || "7d";

/** Générer un token */
function signJwt(payload, options = {}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, ...options });
}

/** Vérifier/décoder un token – renvoie l'objet décodé ou null si invalide */
function verifyJwt(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/* Aliases pour compatibilité éventuelle */
const generateToken = signJwt;
const verifyToken = verifyJwt;

module.exports = { signJwt, verifyJwt, generateToken, verifyToken };
