// backend/db.js
// ✅ Version Turso (libSQL) pour déploiement sur Vercel

const { createClient } = require("@libsql/client");

// ⚠️ À définir dans ton .env ou dans les variables d'env Vercel
// TURSO_DATABASE_URL="libsql://..."
// TURSO_AUTH_TOKEN="...token..."

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Simple test de connexion
async function connectDB() {
  try {
    await db.execute("SELECT 1");
    console.log("✅ Turso (libSQL) connecté");
  } catch (err) {
    console.error("❌ Erreur de connexion à Turso:", err);
    throw err;
  }
}

// Fonction query universelle (équivalent de ton ancien sequelize.query)
async function query(sql, params = []) {
  // libSQL attend un objet { sql, args }
  const result = await db.execute({
    sql,
    args: params,
  });

  // result.rows -> tableau d'objets { col: value }
  return result;
}

module.exports = { db, connectDB, query };
