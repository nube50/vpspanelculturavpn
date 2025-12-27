const jwt = require('jsonwebtoken');
const { config } = require('./config');
const { AdminModel, VpsModel, UserModel, LogModel, SettingsModel } = require('./models');
const { 
  UserSSHService, 
  MonitorService, 
  MaintenanceService 
} = require('./services');
const {
  successResponse,
  errorResponse,
  generatePassword,
  addDays,
  formatDate,
  logger
} = require('./utils');

const userSSHService = new UserSSHService();
const monitorService = new MonitorService();
const maintenanceService = new MaintenanceService();

// ============================================
// AUTH CONTROLLER
// ============================================
const AuthController = {
  async login(req, res) {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return errorResponse(res, 'Usuario y contraseña requeridos', 400);
      }
      
      const admin = await AdminModel.findByUsername(username);
      
      if (!admin) {
        return errorResponse(res, 'Credenciales inválidas', 401);
      }
      
      const validPassword = await AdminModel.verifyPassword(password, admin.password);
      
      if (!validPassword) {
        return errorResponse(res, 'Credenciales inválidas', 401);
      }
      
      const token = jwt.sign(
        { id: admin.id, username: admin.username },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn }
      );
      
      await LogModel.create('login', `Usuario ${username} inició sesión`);
      
      return successResponse(res, { token, username: admin.username }, 'Login exitoso');
    } catch (error) {
      logger.error('Error en login:', error);
      return errorResponse(res, 'Error al iniciar sesión');
    }
  },
  
  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const username = req.user.username;
      
      if (!currentPassword || !newPassword) {
        return errorResponse(res, 'Contraseñas requeridas', 400);
      }
      
      const admin = await AdminModel.findByUsername(username);
      const validPassword = await AdminModel.verifyPassword(currentPassword, admin.password);
      
      if (!validPassword) {
        return errorResponse(res, 'Contraseña actual incorrecta', 401);
      }
      
      await AdminModel.updatePassword(username, newPassword);
      await LogModel.create('password_change', `Contraseña cambiada para ${username}`);
      
      return successResponse(res, null, 'Contraseña actualizada exitosamente');
    } catch (error) {
      logger.error('Error cambiando contraseña:', error);
      return errorResponse(res, 'Error al cambiar contraseña');
    }
  }
};

// ============================================
// VPS CONTROLLER
// ============================================
const VpsController = {
  async getAll(req, res) {
    try {
      const vpsList = await VpsModel.getAll();
      return successResponse(res, vpsList);
    } catch (error) {
      logger.error('Error obteniendo VPS:', error);
      return errorResponse(res, 'Error al obtener lista de VPS');
    }
  },
  
  async getById(req, res) {
    try {
      const { id } = req.params;
      const vps = await VpsModel.getById(id);
      
      if (!vps) {
        return errorResponse(res, 'VPS no encontrada', 404);
      }
      
      return successResponse(res, vps);
    } catch (error) {
      logger.error('Error obteniendo VPS:', error);
      return errorResponse(res, 'Error al obtener VPS');
    }
  },
  
  async create(req, res) {
    try {
      const vpsData = req.body;
      const vpsId = await VpsModel.create(vpsData);
      
      await LogModel.create('vps_create', `VPS ${vpsData.name} creada`, vpsId);
      
      return successResponse(res, { id: vpsId }, 'VPS creada exitosamente', 201);
    } catch (error) {
      logger.error('Error creando VPS:', error);
      
      if (error.message.includes('UNIQUE constraint')) {
        return errorResponse(res, 'Ya existe una VPS con ese nombre', 409);
      }
      
      return errorResponse(res, 'Error al crear VPS');
    }
  },
  
  async update(req, res) {
    try {
      const { id } = req.params;
      const vpsData = req.body;
      
      const vps = await VpsModel.getById(id);
      if (!vps) {
        return errorResponse(res, 'VPS no encontrada', 404);
      }
      
      await VpsModel.update(id, vpsData);
      await LogModel.create('vps_update', `VPS ${vps.name} actualizada`, id);
      
      return successResponse(res, null, 'VPS actualizada exitosamente');
    } catch (error) {
      logger.error('Error actualizando VPS:', error);
      return errorResponse(res, 'Error al actualizar VPS');
    }
  },
  
  async delete(req, res) {
    try {
      const { id } = req.params;
      
      const vps = await VpsModel.getById(id);
      if (!vps) {
        return errorResponse(res, 'VPS no encontrada', 404);
      }
      
      await VpsModel.delete(id);
      await LogModel.create('vps_delete', `VPS ${vps.name} eliminada`, id);
      
      return successResponse(res, null, 'VPS eliminada exitosamente');
    } catch (error) {
      logger.error('Error eliminando VPS:', error);
      return errorResponse(res, 'Error al eliminar VPS');
    }
  },
  
  async getStatus(req, res) {
    try {
      const { id } = req.params;
      const vps = await VpsModel.getById(id);
      
      if (!vps) {
        return errorResponse(res, 'VPS no encontrada', 404);
      }
      
      const systemInfo = await monitorService.getSystemInfo(vps);
      return successResponse(res, systemInfo);
    } catch (error) {
      logger.error('Error obteniendo estado de VPS:', error);
      return errorResponse(res, 'Error al obtener estado de VPS');
    }
  },
  
  async getAllStatus(req, res) {
    try {
      const vpsList = await VpsModel.getAll();
      const statusPromises = vpsList.map(vps => monitorService.getSystemInfo(vps));
      const statuses = await Promise.all(statusPromises);
      
      return successResponse(res, statuses);
    } catch (error) {
      logger.error('Error obteniendo estados de VPS:', error);
      return errorResponse(res, 'Error al obtener estados de VPS');
    }
  }
};

// ============================================
// USER CONTROLLER
// ============================================
const UserController = {
  async getAll(req, res) {
    try {
      const { vps_id, vps_ids, status } = req.query;
      let users;
      
      if (vps_ids) {
        const ids = vps_ids.split(',').map(id => parseInt(id));
        users = await UserModel.getByVpsIds(ids);
      } else if (vps_id) {
        users = await UserModel.getByVpsId(vps_id);
      } else if (status) {
        users = await UserModel.getByStatus(status);
      } else {
        users = await UserModel.getAll();
      }
      
      return successResponse(res, users);
    } catch (error) {
      logger.error('Error obteniendo usuarios:', error);
      return errorResponse(res, 'Error al obtener usuarios');
    }
  },
  
  async create(req, res) {
    try {
      const { 
        username, 
        password: userPassword, 
        days, 
        vps_ids, 
        connection_limit,
        auto_generate_password 
      } = req.body;
      
      // Generar contraseña si se solicita
      const password = auto_generate_password ? generatePassword(12) : userPassword;
      
      if (!password) {
        return errorResponse(res, 'Contraseña requerida', 400);
      }
      
      // Calcular fecha de expiración
      const expirationDate = formatDate(addDays(new Date(), parseInt(days)));
      
      // Obtener VPS
      const vpsList = await VpsModel.getByIds(vps_ids);
      
      if (vpsList.length === 0) {
        return errorResponse(res, 'No se encontraron VPS válidas', 404);
      }
      
      const results = [];
      
      // Crear usuario en cada VPS
      for (const vps of vpsList) {
        try {
          // Verificar si ya existe
          const existing = await UserModel.getByUsername(vps.id, username);
          if (existing) {
            results.push({
              vps: vps.name,
              success: false,
              error: 'Usuario ya existe en esta VPS'
            });
            continue;
          }
          
          // Crear en el servidor
          await userSSHService.createUser(vps, username, password, expirationDate);
          
          // Guardar en base de datos
          const userId = await UserModel.create({
            vps_id: vps.id,
            username,
            password,
            expiration_date: expirationDate,
            connection_limit: connection_limit || null
          });
          
          await LogModel.create(
            'user_create',
            `Usuario ${username} creado en ${vps.name}`,
            vps.id,
            userId
          );
          
          results.push({
            vps: vps.name,
            success: true,
            userId
          });
        } catch (error) {
          results.push({
            vps: vps.name,
            success: false,
            error: error.message
          });
        }
      }
      
      return successResponse(res, { 
        results, 
        password: auto_generate_password ? password : undefined 
      }, 'Operación completada', 201);
    } catch (error) {
      logger.error('Error creando usuarios:', error);
      return errorResponse(res, 'Error al crear usuarios');
    }
  },
  
  async update(req, res) {
    try {
      const { id } = req.params;
      const { password, expiration_date, connection_limit, auto_generate_password } = req.body;
      
      const user = await UserModel.getById(id);
      if (!user) {
        return errorResponse(res, 'Usuario no encontrado', 404);
      }
      
      const vps = await VpsModel.getById(user.vps_id);
      
      const updateData = {};
      
      // Actualizar contraseña
      if (password || auto_generate_password) {
        const newPassword = auto_generate_password ? generatePassword(12) : password;
        await userSSHService.changePassword(vps, user.username, newPassword);
        updateData.password = newPassword;
      }
      
      // Actualizar expiración
      if (expiration_date) {
        await userSSHService.updateExpiration(vps, user.username, expiration_date);
        updateData.expiration_date = expiration_date;
      }
      
      // Actualizar límite de conexiones
      if (connection_limit !== undefined) {
        updateData.connection_limit = connection_limit;
      }
      
      await UserModel.update(id, updateData);
      await LogModel.create('user_update', `Usuario ${user.username} actualizado`, user.vps_id, id);
      
      return successResponse(res, { 
        password: auto_generate_password ? updateData.password : undefined 
      }, 'Usuario actualizado exitosamente');
    } catch (error) {
      logger.error('Error actualizando usuario:', error);
      return errorResponse(res, 'Error al actualizar usuario');
    }
  },
  
  async delete(req, res) {
    try {
      const { id } = req.params;
      
      const user = await UserModel.getById(id);
      if (!user) {
        return errorResponse(res, 'Usuario no encontrado', 404);
      }
      
      const vps = await VpsModel.getById(user.vps_id);
      
      // Eliminar del servidor
      await userSSHService.deleteUser(vps, user.username);
      
      // Eliminar de la base de datos
      await UserModel.delete(id);
      await LogModel.create('user_delete', `Usuario ${user.username} eliminado`, user.vps_id, id);
      
      return successResponse(res, null, 'Usuario eliminado exitosamente');
    } catch (error) {
      logger.error('Error eliminando usuario:', error);
      return errorResponse(res, 'Error al eliminar usuario');
    }
  },
  
  async renew(req, res) {
    try {
      const { id } = req.params;
      const { days, from_expiration } = req.body;
      
      if (!days || days < 1) {
        return errorResponse(res, 'Días inválidos', 400);
      }
      
      const user = await UserModel.getById(id);
      if (!user) {
        return errorResponse(res, 'Usuario no encontrado', 404);
      }
      
      const vps = await VpsModel.getById(user.vps_id);
      
      // Calcular nueva fecha
      const baseDate = from_expiration ? new Date(user.expiration_date) : new Date();
      const newExpirationDate = formatDate(addDays(baseDate, parseInt(days)));
      
      // Actualizar en el servidor
      await userSSHService.updateExpiration(vps, user.username, newExpirationDate);
      
      // Actualizar en base de datos
      await UserModel.update(id, { expiration_date: newExpirationDate });
      await LogModel.create('user_renew', `Usuario ${user.username} renovado por ${days} días`, user.vps_id, id);
      
      return successResponse(res, { new_expiration_date: newExpirationDate }, 'Usuario renovado exitosamente');
    } catch (error) {
      logger.error('Error renovando usuario:', error);
      return errorResponse(res, 'Error al renovar usuario');
    }
  },
  
  async block(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      
      const user = await UserModel.getById(id);
      if (!user) {
        return errorResponse(res, 'Usuario no encontrado', 404);
      }
      
      const vps = await VpsModel.getById(user.vps_id);
      
      await userSSHService.blockUser(vps, user.username);
      await UserModel.updateStatus(id, 'blocked', reason || 'Bloqueado manualmente');
      await LogModel.create('user_block', `Usuario ${user.username} bloqueado`, user.vps_id, id);
      
      return successResponse(res, null, 'Usuario bloqueado exitosamente');
    } catch (error) {
      logger.error('Error bloqueando usuario:', error);
      return errorResponse(res, 'Error al bloquear usuario');
    }
  },
  
  async unblock(req, res) {
    try {
      const { id } = req.params;
      
      const user = await UserModel.getById(id);
      if (!user) {
        return errorResponse(res, 'Usuario no encontrado', 404);
      }
      
      const vps = await VpsModel.getById(user.vps_id);
      
      await userSSHService.unblockUser(vps, user.username);
      await UserModel.updateStatus(id, 'active', null);
      await LogModel.create('user_unblock', `Usuario ${user.username} desbloqueado`, user.vps_id, id);
      
      return successResponse(res, null, 'Usuario desbloqueado exitosamente');
    } catch (error) {
      logger.error('Error desbloqueando usuario:', error);
      return errorResponse(res, 'Error al desbloquear usuario');
    }
  },
  
  async getConnections(req, res) {
    try {
      const { id } = req.params;
      
      const user = await UserModel.getById(id);
      if (!user) {
        return errorResponse(res, 'Usuario no encontrado', 404);
      }
      
      const vps = await VpsModel.getById(user.vps_id);
      const connections = await userSSHService.getConnections(vps, user.username);
      
      return successResponse(res, { 
        username: user.username,
        connections,
        limit: user.connection_limit
      });
    } catch (error) {
      logger.error('Error obteniendo conexiones:', error);
      return errorResponse(res, 'Error al obtener conexiones');
    }
  }
};

// ============================================
// MAINTENANCE CONTROLLER
// ============================================
const MaintenanceController = {
  async cleanLogs(req, res) {
    try {
      const { vps_ids } = req.body;
      
      if (!vps_ids || vps_ids.length === 0) {
        return errorResponse(res, 'Debe seleccionar al menos una VPS', 400);
      }
      
      const vpsList = await VpsModel.getByIds(vps_ids);
      const results = [];
      
      for (const vps of vpsList) {
        try {
          await maintenanceService.cleanLogs(vps);
          await LogModel.create('clean_logs', `Logs limpiados en ${vps.name}`, vps.id);
          results.push({ vps: vps.name, success: true });
        } catch (error) {
          results.push({ vps: vps.name, success: false, error: error.message });
        }
      }
      
      return successResponse(res, { results }, 'Operación completada');
    } catch (error) {
      logger.error('Error limpiando logs:', error);
      return errorResponse(res, 'Error al limpiar logs');
    }
  },
  
  async restartVps(req, res) {
    try {
      const { vps_ids } = req.body;
      
      if (!vps_ids || vps_ids.length === 0) {
        return errorResponse(res, 'Debe seleccionar al menos una VPS', 400);
      }
      
      const vpsList = await VpsModel.getByIds(vps_ids);
      const results = [];
      
      for (const vps of vpsList) {
        try {
          await maintenanceService.restartVps(vps);
          await LogModel.create('restart_vps', `VPS ${vps.name} reiniciada`, vps.id);
          results.push({ vps: vps.name, success: true });
        } catch (error) {
          results.push({ vps: vps.name, success: false, error: error.message });
        }
      }
      
      return successResponse(res, { results }, 'Operación completada');
    } catch (error) {
      logger.error('Error reiniciando VPS:', error);
      return errorResponse(res, 'Error al reiniciar VPS');
    }
  },
  
  async checkExpired(req, res) {
    try {
      const expiredUsers = await UserModel.getExpired();
      
      for (const user of expiredUsers) {
        const vps = await VpsModel.getById(user.vps_id);
        await userSSHService.blockUser(vps, user.username);
        await UserModel.updateStatus(user.id, 'blocked', 'Usuario expirado');
        await LogModel.create('auto_block', `Usuario ${user.username} bloqueado por expiración`, user.vps_id, user.id);
      }
      
      return successResponse(res, { 
        count: expiredUsers.length,
        users: expiredUsers 
      }, 'Verificación completada');
    } catch (error) {
      logger.error('Error verificando expirados:', error);
      return errorResponse(res, 'Error al verificar usuarios expirados');
    }
  }
};

// ============================================
// SETTINGS CONTROLLER
// ============================================
const SettingsController = {
  async get(req, res) {
    try {
      const settings = await SettingsModel.getAll();
      return successResponse(res, settings);
    } catch (error) {
      logger.error('Error obteniendo configuración:', error);
      return errorResponse(res, 'Error al obtener configuración');
    }
  },
  
  async update(req, res) {
    try {
      const settings = req.body;
      await SettingsModel.updateMultiple(settings);
      await LogModel.create('settings_update', 'Configuración actualizada');
      
      return successResponse(res, null, 'Configuración actualizada exitosamente');
    } catch (error) {
      logger.error('Error actualizando configuración:', error);
      return errorResponse(res, 'Error al actualizar configuración');
    }
  }
};

// ============================================
// DASHBOARD CONTROLLER
// ============================================
const DashboardController = {
  async getStats(req, res) {
    try {
      const vpsList = await VpsModel.getAll();
      const userStats = await UserModel.getStats();
      
      const vpsOnline = vpsList.filter(v => v.status === 'online').length;
      const vpsOffline = vpsList.filter(v => v.status === 'offline').length;
      
      return successResponse(res, {
        vps: {
          total: vpsList.length,
          online: vpsOnline,
          offline: vpsOffline
        },
        users: userStats
      });
    } catch (error) {
      logger.error('Error obteniendo estadísticas:', error);
      return errorResponse(res, 'Error al obtener estadísticas');
    }
  }
};

module.exports = {
  AuthController,
  VpsController,
  UserController,
  MaintenanceController,
  SettingsController,
  DashboardController
};
