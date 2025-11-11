// backend/models/index.js
const { sequelize } = require("../db");
const User = require("./User");

async function syncModels() {
  // { alter: true } pour MAJ auto du schéma en dev
  await sequelize.sync({ alter: true });
  console.log("✅ Modèles synchronisés");
}


async function syncModels() {
  // ⚠️ Ne pas forcer alter tout le temps
  await sequelize.sync(); // <-- PAS { alter: true }
}

module.exports = { User, syncModels };


