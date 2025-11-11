// backend/middleware/auth.js
const { verifyJwt } = require("../utils/jwt");

/** Récupère un token depuis Authorization: Bearer ... OU cookie "token" */
function extractToken(req) {
  // 1) Authorization: Bearer <token>
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();

  // 2) Cookie "token" (si tu en utilises)
  // nécessite cookie-parser si tu veux vraiment lire req.cookies.token
  if (req.cookies && req.cookies.token) return req.cookies.token;

  // 3) En dernier recours: x-access-token
  if (req.headers["x-access-token"]) return String(req.headers["x-access-token"]).trim();

  return null;
}

/** Auth requise */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ message: "Token manquant" });

  const decoded = verifyJwt(token);
  if (!decoded) return res.status(401).json({ message: "Token invalide ou expiré" });

  req.user = decoded; // { id, email, role, ... }
  next();
}

/** Rôle requis */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Non authentifié" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Accès refusé : rôle non autorisé" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
