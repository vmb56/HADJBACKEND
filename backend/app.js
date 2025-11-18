// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const { connectDB } = require("./db");

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

/* ------------ CORS (PROD UNIQUEMENT) ------------ */
// 👉 On ne garde QUE ce qui est dans CORS_ORIGIN
// ex sur Render : CORS_ORIGIN="https://bmvt-app-gestion-xxxxx.vercel.app"
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!ALLOWED_ORIGINS.length) {
  console.warn(
    "⚠️ Aucun CORS_ORIGIN défini. Le backend refusera toutes les origines de navigateur."
  );
}

const CORS_OPTIONS = {
  origin(origin, callback) {
    // Requêtes sans origin (curl / Postman / healthcheck Render) -> OK
    if (!origin) return callback(null, true);

    if (ALLOWED_ORIGINS.includes(origin)) {
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
app.get("/", (_req, res) =>
  res.send("✅ API Backend BMVT en marche avec Turso !")
);
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
      err?.stack && process.env.NODE_ENV !== "production"
        ? err.stack
        : undefined,
  });
});

/* ------------ Boot ------------ */
const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await connectDB();

    console.log(
      `🚀 Serveur backend BMVT démarré sur le port ${PORT}. Origins CORS autorisées :`,
      ALLOWED_ORIGINS
    );

    app.listen(PORT, () => {});
  } catch (e) {
    console.error("❌ Erreur au démarrage:", e);
    process.exit(1);
  }
})();
