// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const { connectDB } = require("./db");

// Routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const pelerinRoutes = require("./routes/pelerins");
const medicalesRoutes = require("./routes/medicales");
const voyageRoutes = require("./routes/voyages");
const volsRouter = require("./routes/vols");
const versementsRouter = require("./routes/versements");
const offresRouter = require("./routes/offres");
const chambresRouter = require("./routes/chambres");
const paiementsRouter = require("./routes/paiements");
const pelerinspaiementRouter = require("./routes/pelerinspaiement");
const chatRouter = require("./routes/chat");

const app = express();

/* ------------ App config ------------ */
app.disable("x-powered-by");
app.set("trust proxy", 1);

/* ------------ CORS TRÈS SIMPLE ------------ */
// ✅ Autorise toutes les origines (ton front Vercel, ton téléphone, etc.)
app.use(
  cors({
    origin: true,        // reflète l'origin qui fait la requête
    credentials: true,   // si un jour tu utilises des cookies
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// OPTIONS préflight
app.options(
  "*",
  cors({
    origin: true,
    credentials: true,
  })
);

/* ------------ Parsers ------------ */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* ------------ Static ------------ */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ------------ Routes ------------ */
app.get("/", (_req, res) =>
  res.send("✅ API Backend BMVT en marche avec Turso !")
);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/pelerins", pelerinRoutes);
app.use("/api/medicales", medicalesRoutes);
app.use("/api/voyages", voyageRoutes);
app.use("/api/vols", volsRouter);
app.use("/api/chambres", chambresRouter);
app.use("/api/paiements", paiementsRouter);
app.use("/api/versements", versementsRouter);
app.use("/api/pelerinspaiement", pelerinspaiementRouter);
app.use("/api/offres", offresRouter);
app.use("/api/chat", chatRouter);

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

    app.listen(PORT, () => {
      console.log(`🚀 Serveur backend BMVT démarré sur le port ${PORT}`);
    });
  } catch (e) {
    console.error("❌ Erreur au démarrage:", e);
    process.exit(1);
  }
})();
