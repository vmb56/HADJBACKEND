// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const { connectDB } = require("./db");

// ⛔ Sequelize / syncModels désactivé, car on passe à Turso
// const { syncModels } = require("./models");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const pelerinRoutes = require("./routes/pelerins");
const medicalesRoutes = require("./routes/medicales");
const voyageRoutes = require("./routes/voyages");
const volsRouter = require("./routes/vols");
const versementsRouter = require("./routes/versements");
const offresRouter = require("./routes/offres");

const app = express();

/* ------------ App config ------------ */
app.disable("x-powered-by");
app.set("trust proxy", 1);

/* ------------ CORS ------------ */
// Origins “fixes” (localhost + quelques URLs Vercel connues)
const STATIC_ORIGINS =
  (process.env.CORS_ORIGIN &&
    process.env.CORS_ORIGIN.split(",")
      .map((s) => s.trim())
      .filter(Boolean)) || [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    // anciens / nouveaux déploiements Vercel déjà connus
    "https://bmvt-app-gestion-rgytqshwv-valybamba56-gmailcoms-projects.vercel.app",
    "https://bmvt-app-gestion-aiok39yvm-valybamba56-gmailcoms-projects.vercel.app",
  ];

// Options CORS avec fonction dynamique
const CORS_OPTIONS = {
  origin(origin, callback) {
    // Requêtes sans origin (ex: curl, Postman) -> OK
    if (!origin) return callback(null, true);

    // Autoriser les origins listés
    if (STATIC_ORIGINS.includes(origin)) {
      return callback(null, true);
    }

    // Autoriser tous les bmvt-app-gestion-*.vercel.app
    const vercelPattern = /^https:\/\/bmvt-app-gestion-.*\.vercel\.app$/;
    if (vercelPattern.test(origin)) {
      return callback(null, true);
    }

    // Sinon, refus
    return callback(new Error("Origin non autorisé par CORS"), false);
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};

app.use(cors(CORS_OPTIONS));
app.options("*", cors(CORS_OPTIONS));

/* ------------ Parsers ------------ */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* ------------ Static ------------ */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ------------ Routes ------------ */
app.use("/api/vols", volsRouter);
app.get("/", (_req, res) => res.send("✅ API Backend BMVT en marche avec Turso !"));
app.use("/api/voyages", voyageRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/pelerins", pelerinRoutes);
app.use("/api/medicales", medicalesRoutes);
app.use("/api/chambres", require("./routes/chambres"));
app.use("/api/paiements", require("./routes/paiements"));
app.use("/api/versements", versementsRouter);
app.use("/api/pelerinspaiement", require("./routes/pelerinspaiement"));
app.use("/api/offres", offresRouter);
app.use("/api/chat", require("./routes/chat"));

/* ------------ 404 ------------ */
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

    // ❌ plus de syncModels ici
    // if (typeof syncModels === "function") {
    //   await syncModels();
    // }

    console.log(
      `🚀 Serveur backend BMVT démarré sur le port ${PORT}. Origins CORS :`,
      STATIC_ORIGINS.join(" , "),
      "+ pattern bmvt-app-gestion-*.vercel.app"
    );

    app.listen(PORT, () => {});
  } catch (e) {
    console.error("❌ Erreur au démarrage:", e);
    process.exit(1);
  }
})();
