const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

// ============================================
// CONFIGURACIÓN GENERAL
// ============================================
const config = {
  port: process.env.PORT || 3001,
  jwtSecret: process.env.JWT_SECRET || 'change_this_secret_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  dbPath: process.env.DB_PATH || path.join(__dirname, 'database.sqlite'),
  
  // Admin inicial
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  
  // Monitoreo
  autoCheckEnabled: process.env.AUTO_CHECK_ENABLED === 'true',
  checkInterval: parseInt(process.env.CHECK_INTERVAL) || 5,
  checkOnlyLimitedUsers: process.env.CHECK_ONLY_LIMITED_USERS === 'true',
  distributeChecks: process.env.DISTRIBUTE_CHECKS === 'true',
  
  // Dashboard
  dashboardUpdateInterval: parseInt(process.env.DASHBOARD_UPDATE_INTERVAL) || 60,
  
  // Logs
  logLevel: process.env.LOG_LEVEL || 'info',
  logMaxSize: process.env.LOG_MAX_SIZE || '10m',
  logMaxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
  logMaxDays: parseInt(process.env.LOG_MAX_DAYS) || 30
};

// ============================================
// BASE DE DATOS
// ============================================
class Database {
  constructor() {
    this.db = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(config.dbPath, async (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('✅ Base de datos SQLite conectada');
          await this.createTables();
          await this.createAdminUser();
          resolve();
        }
      });
    });
  }

  async createTables() {
    const tables = [
      // Tabla de VPS
      `CREATE TABLE IF NOT EXISTS vps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        ip TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        ssh_user TEXT NOT NULL,
        ssh_password TEXT,
        ssh_key TEXT,
        country TEXT,
        provider TEXT,
        notes TEXT,
        status TEXT DEFAULT 'unknown',
        last_check DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Tabla de usuarios SSH
      `CREATE TABLE IF NOT EXISTS ssh_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vps_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        expiration_date DATE NOT NULL,
        connection_limit INTEGER DEFAULT NULL,
        status TEXT DEFAULT 'active',
        blocked_reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vps_id) REFERENCES vps(id) ON DELETE CASCADE,
        UNIQUE(vps_id, username)
      )`,

      // Tabla de administradores
      `CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Tabla de logs/operaciones
      `CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL,
        details TEXT,
        vps_id INTEGER,
        user_id INTEGER,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Tabla de configuración del sistema
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      await this.run(sql);
    }

    // Insertar configuraciones por defecto
    const defaultSettings = [
      ['auto_check_enabled', config.autoCheckEnabled ? '1' : '0'],
      ['check_interval', config.checkInterval.toString()],
      ['dashboard_update_interval', config.dashboardUpdateInterval.toString()]
    ];

    for (const [key, value] of defaultSettings) {
      await this.run(
        'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
        [key, value]
      );
    }

    console.log('✅ Tablas creadas correctamente');
  }

  async createAdminUser() {
    const exists = await this.get('SELECT * FROM admins WHERE username = ?', [config.adminUsername]);
    
    if (!exists) {
      const hashedPassword = await bcrypt.hash(config.adminPassword, 10);
      await this.run(
        'INSERT INTO admins (username, password) VALUES (?, ?)',
        [config.adminUsername, hashedPassword]
      );
      console.log(`✅ Usuario admin creado: ${config.adminUsername}`);
      console.log(`⚠️  IMPORTANTE: Cambia la contraseña después del primer login`);
    }
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

const database = new Database();

module.exports = { config, database };
