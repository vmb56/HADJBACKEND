// backend/db.js
const { Sequelize, QueryTypes } = require("sequelize");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: "mysql",
    logging: process.env.NODE_ENV === "development" ? console.log : false,
    define: { timestamps: true }
  }
);

async function connectDB() {
  await sequelize.authenticate();
  console.log("✅ MySQL connecté");
}

// 💡 ajout d'une fonction query universelle
async function query(sql, params = []) {
  return sequelize.query(sql, {
    replacements: params,
    type: QueryTypes.RAW, // ou SELECT, selon ton besoin
  });
}

module.exports = { sequelize, connectDB, query };
