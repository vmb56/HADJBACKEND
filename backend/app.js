// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const { connectDB } = require("./db");
// Si ton index exporte { syncModels }, ceci suffit. Sinon mets "./models/index".
const { syncModels } = require("./models");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const pelerinRoutes = require("./routes/pelerins");
const medicalesRoutes = require("./routes/medicales");
const voyageRoutes = require("./routes/voyages"); // ⬅️ nouveau
const volsRouter = require("./routes/vols");
const versementsRouter = require("./routes/versements");
 const offresRouter = require("./routes/offres");
const app = express();

/* ------------ App config ------------ */
app.disable("x-powered-by");
app.set("trust proxy", 1); // si derrière un proxy / nginx

// 🔐 CORS — doit être AVANT TOUTES LES ROUTES
const ORIGINS =
  (process.env.CORS_ORIGIN &&
    process.env.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)) || [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];

const CORS_OPTIONS = {
  origin: ORIGINS, // liste blanche
  credentials: true, // OK si tu utilises des cookies sur certaines routes
  allowedHeaders: ["Content-Type", "Authorization"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};

app.use(cors(CORS_OPTIONS));
// indispensable pour les préflight bloqués
app.options("*", cors(CORS_OPTIONS));

// Parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Static: servir les fichiers uploadés
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ------------ Routes ------------ */
app.use("/api/vols", volsRouter);
app.get("/", (_req, res) => res.send("✅ API Backend BMVT en marche !"));
app.use("/api/voyages", voyageRoutes); // ⬅️ nouveau
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/pelerins", pelerinRoutes);
app.use("/api/medicales", medicalesRoutes); // ⬅️ placé APRÈS CORS et parsers
app.use("/api/chambres", require("./routes/chambres"));
app.use("/api/paiements", require("./routes/paiements"));
app.use("/api/versements", versementsRouter);
app.use("/api/pelerinspaiement", require("./routes/pelerinspaiement"));
app.use("/api/offres", offresRouter);
app.use("/api/chat", require("./routes/chat")); // la route chat fournie
/* ------------ 404 (optionnel) ------------ */
app.use((req, res, _next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ message: "Route introuvable" });
  }
  return res.status(404).send("Not found");
});

/* ------------ Error handler global ------------ */
app.use((err, _req, res, _next) => {
  console.error("❌ Uncaught error:", err);
  const code = err.status || err.statusCode || 500;
  res.status(code).json({
    message: err.message || "Erreur serveur",
    detail:
      err?.stack && process.env.NODE_ENV !== "production" ? err.stack : undefined,
  });
});

/* ------------ Boot ------------ */
const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await connectDB();
    if (typeof syncModels === "function") {
      await syncModels();
    }
    app.listen(PORT, () =>
      console.log(`🚀 Serveur sur ${ORIGINS.join(" , ")} → http://localhost:${PORT}`)
    );
  } catch (e) {
    console.error("❌ Erreur au démarrage:", e);
    process.exit(1);
  }
})();
