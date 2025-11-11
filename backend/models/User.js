// backend/models/User.js
const { DataTypes } = require("sequelize");
const bcrypt = require("bcryptjs");
const { sequelize } = require("../db");

const User = sequelize.define(
  "User",
  {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true,
    },

    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },

    email: {
      type: DataTypes.STRING(160),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },

    role: {
      type: DataTypes.ENUM("Agent", "Admin", "Superviseur"),
      allowNull: false,
      defaultValue: "Agent",
    },

    // Hash stocké en base
    passwordHash: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },

    // Champ VIRTUEL pour accepter un mot de passe en clair
    // et déclencher le hash automatique via le hook beforeSave
    password: {
      type: DataTypes.VIRTUAL,
      set(value) {
        // on garde la valeur virtuelle (non persistée)
        this.setDataValue("password", value);
        // on marque un "buffer" pour le hook
        this._plainPassword = value;
      },
      get() {
        return undefined; // ne jamais renvoyer
      },
    },

    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "users",
    timestamps: true,

    hooks: {
      // Hash automatique si un mot de passe clair a été fourni
      async beforeSave(user) {
        if (user._plainPassword != null && user._plainPassword !== "") {
          const pwd = String(user._plainPassword);
          if (pwd.length < 8) {
            throw new Error("Le mot de passe doit contenir au moins 8 caractères.");
          }
          const hash = await bcrypt.hash(pwd, 10);
          user.passwordHash = hash;
          user._plainPassword = undefined;
        }
      },
    },

    defaultScope: {
      // rien de spécial
    },

    // Masquer passwordHash dans les réponses JSON
    defaultValue: {},
  }
);

// Méthodes d’instance
User.prototype.verifyPassword = async function (password) {
  if (!this.passwordHash) return false;
  try {
    return await bcrypt.compare(String(password || ""), String(this.passwordHash));
  } catch {
    return false;
  }
};

// Nettoyage de la sortie JSON (on retire le hash)
const rawToJSON = User.prototype.toJSON;
User.prototype.toJSON = function () {
  const val = rawToJSON ? rawToJSON.call(this) : { ...this.get() };
  delete val.passwordHash;
  delete val.password; // virtuel
  return val;
};

module.exports = User;
