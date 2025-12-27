const { database } = require('./config');
const bcrypt = require('bcryptjs');

// ============================================
// MODELO DE ADMINS
// ============================================
const AdminModel = {
  async findByUsername(username) {
    return await database.get('SELECT * FROM admins WHERE username = ?', [username]);
  },
  
  async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  },
  
  async updatePassword(username, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    return await database.run(
      'UPDATE admins SET password = ? WHERE username = ?',
      [hashedPassword, username]
    );
  }
};

// ============================================
// MODELO DE VPS
// ============================================
const VpsModel = {
  async getAll() {
    return await database.all('SELECT * FROM vps ORDER BY created_at DESC');
  },
  
  async getById(id) {
    return await database.get('SELECT * FROM vps WHERE id = ?', [id]);
  },
  
  async create(data) {
    const { name, ip, port, ssh_user, ssh_password, ssh_key, country, provider, notes } = data;
    const result = await database.run(
      `INSERT INTO vps (name, ip, port, ssh_user, ssh_password, ssh_key, country, provider, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, ip, port || 22, ssh_user, ssh_password, ssh_key, country, provider, notes]
    );
    return result.id;
  },
  
  async update(id, data) {
    const { name, ip, port, ssh_user, ssh_password, ssh_key, country, provider, notes } = data;
    return await database.run(
      `UPDATE vps SET 
        name = COALESCE(?, name),
        ip = COALESCE(?, ip),
        port = COALESCE(?, port),
        ssh_user = COALESCE(?, ssh_user),
        ssh_password = COALESCE(?, ssh_password),
        ssh_key = COALESCE(?, ssh_key),
        country = COALESCE(?, country),
        provider = COALESCE(?, provider),
        notes = COALESCE(?, notes),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, ip, port, ssh_user, ssh_password, ssh_key, country, provider, notes, id]
    );
  },
  
  async delete(id) {
    return await database.run('DELETE FROM vps WHERE id = ?', [id]);
  },
  
  async updateStatus(id, status) {
    return await database.run(
      'UPDATE vps SET status = ?, last_check = CURRENT_TIMESTAMP WHERE id = ?',
      [status, id]
    );
  },
  
  async getByIds(ids) {
    const placeholders = ids.map(() => '?').join(',');
    return await database.all(
      `SELECT * FROM vps WHERE id IN (${placeholders})`,
      ids
    );
  }
};

// ============================================
// MODELO DE USUARIOS SSH
// ============================================
const UserModel = {
  async getAll() {
    return await database.all(`
      SELECT u.*, v.name as vps_name, v.ip as vps_ip
      FROM ssh_users u
      JOIN vps v ON u.vps_id = v.id
      ORDER BY u.created_at DESC
    `);
  },
  
  async getByVpsId(vpsId) {
    return await database.all(`
      SELECT u.*, v.name as vps_name, v.ip as vps_ip
      FROM ssh_users u
      JOIN vps v ON u.vps_id = v.id
      WHERE u.vps_id = ?
      ORDER BY u.created_at DESC
    `, [vpsId]);
  },
  
  async getByVpsIds(vpsIds) {
    const placeholders = vpsIds.map(() => '?').join(',');
    return await database.all(`
      SELECT u.*, v.name as vps_name, v.ip as vps_ip
      FROM ssh_users u
      JOIN vps v ON u.vps_id = v.id
      WHERE u.vps_id IN (${placeholders})
      ORDER BY u.created_at DESC
    `, vpsIds);
  },
  
  async getById(id) {
    return await database.get(`
      SELECT u.*, v.name as vps_name, v.ip as vps_ip
      FROM ssh_users u
      JOIN vps v ON u.vps_id = v.id
      WHERE u.id = ?
    `, [id]);
  },
  
  async create(data) {
    const { vps_id, username, password, expiration_date, connection_limit } = data;
    const result = await database.run(
      `INSERT INTO ssh_users (vps_id, username, password, expiration_date, connection_limit)
       VALUES (?, ?, ?, ?, ?)`,
      [vps_id, username, password, expiration_date, connection_limit]
    );
    return result.id;
  },
  
  async update(id, data) {
    const { password, expiration_date, connection_limit, status } = data;
    return await database.run(
      `UPDATE ssh_users SET 
        password = COALESCE(?, password),
        expiration_date = COALESCE(?, expiration_date),
        connection_limit = COALESCE(?, connection_limit),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [password, expiration_date, connection_limit, status, id]
    );
  },
  
  async delete(id) {
    return await database.run('DELETE FROM ssh_users WHERE id = ?', [id]);
  },
  
  async deleteByVpsId(vpsId) {
    return await database.run('DELETE FROM ssh_users WHERE vps_id = ?', [vpsId]);
  },
  
  async updateStatus(id, status, reason = null) {
    return await database.run(
      'UPDATE ssh_users SET status = ?, blocked_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, reason, id]
    );
  },
  
  async getByUsername(vpsId, username) {
    return await database.get(
      'SELECT * FROM ssh_users WHERE vps_id = ? AND username = ?',
      [vpsId, username]
    );
  },
  
  async getExpired() {
    return await database.all(`
      SELECT u.*, v.name as vps_name, v.ip as vps_ip
      FROM ssh_users u
      JOIN vps v ON u.vps_id = v.id
      WHERE u.expiration_date < DATE('now') AND u.status = 'active'
    `);
  },
  
  async getByStatus(status) {
    return await database.all(`
      SELECT u.*, v.name as vps_name, v.ip as vps_ip
      FROM ssh_users u
      JOIN vps v ON u.vps_id = v.id
      WHERE u.status = ?
      ORDER BY u.created_at DESC
    `, [status]);
  },
  
  async getStats() {
    const total = await database.get('SELECT COUNT(*) as count FROM ssh_users');
    const active = await database.get("SELECT COUNT(*) as count FROM ssh_users WHERE status = 'active'");
    const blocked = await database.get("SELECT COUNT(*) as count FROM ssh_users WHERE status = 'blocked'");
    const expired = await database.get("SELECT COUNT(*) as count FROM ssh_users WHERE expiration_date < DATE('now') AND status = 'active'");
    
    return {
      total: total.count,
      active: active.count,
      blocked: blocked.count,
      expired: expired.count
    };
  }
};

// ============================================
// MODELO DE LOGS
// ============================================
const LogModel = {
  async create(operation, details, vps_id = null, user_id = null, status = 'success') {
    return await database.run(
      'INSERT INTO operation_logs (operation, details, vps_id, user_id, status) VALUES (?, ?, ?, ?, ?)',
      [operation, details, vps_id, user_id, status]
    );
  },
  
  async getRecent(limit = 100) {
    return await database.all(
      'SELECT * FROM operation_logs ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
  },
  
  async getByVpsId(vpsId, limit = 50) {
    return await database.all(
      'SELECT * FROM operation_logs WHERE vps_id = ? ORDER BY created_at DESC LIMIT ?',
      [vpsId, limit]
    );
  },
  
  async deleteOld(days = 30) {
    return await database.run(
      "DELETE FROM operation_logs WHERE created_at < datetime('now', '-' || ? || ' days')",
      [days]
    );
  }
};

// ============================================
// MODELO DE SETTINGS
// ============================================
const SettingsModel = {
  async get(key) {
    const result = await database.get('SELECT value FROM settings WHERE key = ?', [key]);
    return result ? result.value : null;
  },
  
  async set(key, value) {
    return await database.run(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [key, value]
    );
  },
  
  async getAll() {
    const rows = await database.all('SELECT * FROM settings');
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    return settings;
  },
  
  async updateMultiple(settings) {
    const promises = Object.entries(settings).map(([key, value]) => 
      this.set(key, value)
    );
    return await Promise.all(promises);
  }
};

module.exports = {
  AdminModel,
  VpsModel,
  UserModel,
  LogModel,
  SettingsModel
};
