const { NodeSSH } = require('node-ssh');
const cron = require('node-cron');
const { VpsModel, UserModel, LogModel, SettingsModel } = require('./models');
const { logger, formatDate, addDays, isExpired, sleep } = require('./utils');

// ============================================
// SERVICIO DE CONEXIÓN SSH
// ============================================
class SSHService {
  async connect(vps) {
    const ssh = new NodeSSH();
    
    try {
      const config = {
        host: vps.ip,
        port: vps.port || 22,
        username: vps.ssh_user,
        timeout: 10000
      };
      
      // Conectar con contraseña o clave privada
      if (vps.ssh_key) {
        config.privateKey = vps.ssh_key;
      } else {
        config.password = vps.ssh_password;
      }
      
      await ssh.connect(config);
      logger.info(`Conexión SSH exitosa a ${vps.name} (${vps.ip})`);
      
      // Actualizar estado
      await VpsModel.updateStatus(vps.id, 'online');
      
      return ssh;
    } catch (error) {
      logger.error(`Error conectando a ${vps.name}: ${error.message}`);
      await VpsModel.updateStatus(vps.id, 'offline');
      throw new Error(`No se pudo conectar a ${vps.name}: ${error.message}`);
    }
  }
  
  async executeCommand(ssh, command) {
    try {
      const result = await ssh.execCommand(command);
      return {
        success: result.code === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code
      };
    } catch (error) {
      throw new Error(`Error ejecutando comando: ${error.message}`);
    }
  }
  
  async disconnect(ssh) {
    if (ssh) {
      ssh.dispose();
    }
  }
}

// ============================================
// SERVICIO DE USUARIOS SSH
// ============================================
class UserSSHService extends SSHService {
  async createUser(vps, username, password, expirationDate) {
    const ssh = await this.connect(vps);
    
    try {
      // Crear usuario
      let result = await this.executeCommand(ssh, `useradd -m -s /bin/bash ${username}`);
      if (!result.success && !result.stderr.includes('already exists')) {
        throw new Error(`Error creando usuario: ${result.stderr}`);
      }
      
      // Establecer contraseña
      result = await this.executeCommand(ssh, `echo '${username}:${password}' | chpasswd`);
      if (!result.success) {
        throw new Error(`Error estableciendo contraseña: ${result.stderr}`);
      }
      
      // Establecer fecha de expiración
      const expDate = formatDate(expirationDate);
      result = await this.executeCommand(ssh, `chage -E ${expDate} ${username}`);
      if (!result.success) {
        logger.warn(`Advertencia al establecer expiración: ${result.stderr}`);
      }
      
      logger.info(`Usuario ${username} creado en ${vps.name}`);
      return true;
    } catch (error) {
      logger.error(`Error creando usuario en ${vps.name}: ${error.message}`);
      throw error;
    } finally {
      await this.disconnect(ssh);
    }
  }
  
  async deleteUser(vps, username) {
    const ssh = await this.connect(vps);
    
    try {
      // Matar procesos del usuario
      await this.executeCommand(ssh, `pkill -u ${username}`);
      await sleep(500);
      
      // Eliminar usuario y su home
      const result = await this.executeCommand(ssh, `userdel -r ${username}`);
      if (!result.success && !result.stderr.includes('does not exist')) {
        throw new Error(`Error eliminando usuario: ${result.stderr}`);
      }
      
      logger.info(`Usuario ${username} eliminado de ${vps.name}`);
      return true;
    } catch (error) {
      logger.error(`Error eliminando usuario de ${vps.name}: ${error.message}`);
      throw error;
    } finally {
      await this.disconnect(ssh);
    }
  }
  
  async changePassword(vps, username, newPassword) {
    const ssh = await this.connect(vps);
    
    try {
      const result = await this.executeCommand(ssh, `echo '${username}:${newPassword}' | chpasswd`);
      if (!result.success) {
        throw new Error(`Error cambiando contraseña: ${result.stderr}`);
      }
      
      logger.info(`Contraseña cambiada para ${username} en ${vps.name}`);
      return true;
    } catch (error) {
      logger.error(`Error cambiando contraseña en ${vps.name}: ${error.message}`);
      throw error;
    } finally {
      await this.disconnect(ssh);
    }
  }
  
  async updateExpiration(vps, username, expirationDate) {
    const ssh = await this.connect(vps);
    
    try {
      const expDate = formatDate(expirationDate);
      const result = await this.executeCommand(ssh, `chage -E ${expDate} ${username}`);
      if (!result.success) {
        throw new Error(`Error actualizando expiración: ${result.stderr}`);
      }
      
      logger.info(`Expiración actualizada para ${username} en ${vps.name}`);
      return true;
    } catch (error) {
      logger.error(`Error actualizando expiración en ${vps.name}: ${error.message}`);
      throw error;
    } finally {
      await this.disconnect(ssh);
    }
  }
  
  async blockUser(vps, username) {
    const ssh = await this.connect(vps);
    
    try {
      const result = await this.executeCommand(ssh, `usermod -L ${username}`);
      if (!result.success) {
        throw new Error(`Error bloqueando usuario: ${result.stderr}`);
      }
      
      logger.info(`Usuario ${username} bloqueado en ${vps.name}`);
      return true;
    } catch (error) {
      logger.error(`Error bloqueando usuario en ${vps.name}: ${error.message}`);
      throw error;
    } finally {
      await this.disconnect(ssh);
    }
  }
  
  async unblockUser(vps, username) {
    const ssh = await this.connect(vps);
    
    try {
      const result = await this.executeCommand(ssh, `usermod -U ${username}`);
      if (!result.success) {
        throw new Error(`Error desbloqueando usuario: ${result.stderr}`);
      }
      
      logger.info(`Usuario ${username} desbloqueado en ${vps.name}`);
      return true;
    } catch (error) {
      logger.error(`Error desbloqueando usuario en ${vps.name}: ${error.message}`);
      throw error;
    } finally {
      await this.disconnect(ssh);
    }
  }
  
  async getConnections(vps, username) {
    const ssh = await this.connect(vps);
    
    try {
      const result = await this.executeCommand(ssh, `ps aux | grep "sshd.*${username}" | grep -v grep | wc -l`);
      if (result.success) {
        const count = parseInt(result.stdout.trim()) || 0;
        return count;
      }
      return 0;
    } catch (error) {
      logger.error(`Error obteniendo conexiones en ${vps.name}: ${error.message}`);
      return 0;
    } finally {
      await this.disconnect(ssh);
    }
  }
  
  async getActiveUsers(vps) {
    const ssh = await this.connect(vps);
    
    try {
      const result = await this.executeCommand(ssh, `who | awk '{print $1}' | sort | uniq -c`);
      if (result.success) {
        const lines = result.stdout.trim().split('\n').filter(line => line);
        const users = [];
        
        for (const line of lines) {
          const match = line.trim().match(/(\d+)\s+(\S+)/);
          if (match) {
            users.push({
              username: match[2],
              connections: parseInt(match[1])
            });
          }
        }
        
        return users;
      }
      return [];
    } catch (error) {
      logger.error(`Error obteniendo usuarios activos en ${vps.name}: ${error.message}`);
      return [];
    } finally {
      await this.disconnect(ssh);
    }
  }
}

// ============================================
// SERVICIO DE MONITOREO
// ============================================
class MonitorService extends SSHService {
  async getSystemInfo(vps) {
    const ssh = await this.connect(vps);
    
    try {
      const info = {
        vpsId: vps.id,
        vpsName: vps.name,
        status: 'online'
      };
      
      // CPU
      const cpuResult = await this.executeCommand(ssh, "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1");
      info.cpuUsage = parseFloat(cpuResult.stdout.trim()) || 0;
      
      // RAM
      const ramResult = await this.executeCommand(ssh, "free | grep Mem | awk '{printf \"%.2f %.2f %.2f\", $3/$2*100, $2/1024, $3/1024}'");
      const ramParts = ramResult.stdout.trim().split(' ');
      info.ramUsage = parseFloat(ramParts[0]) || 0;
      info.ramTotal = parseFloat(ramParts[1]) || 0;
      info.ramUsed = parseFloat(ramParts[2]) || 0;
      
      // Disco
      const diskResult = await this.executeCommand(ssh, "df -h / | tail -1 | awk '{print $5, $2, $3}'");
      const diskParts = diskResult.stdout.trim().split(' ');
      info.diskUsage = parseFloat(diskParts[0]) || 0;
      info.diskTotal = diskParts[1] || '0G';
      info.diskUsed = diskParts[2] || '0G';
      
      // Uptime
      const uptimeResult = await this.executeCommand(ssh, "uptime -p");
      info.uptime = uptimeResult.stdout.trim().replace('up ', '');
      
      // Puertos abiertos
      const portsResult = await this.executeCommand(ssh, "ss -tuln | grep LISTEN | awk '{print $5}' | cut -d':' -f2 | sort -u");
      info.ports = portsResult.stdout.trim().split('\n').filter(p => p && !isNaN(p)).map(p => parseInt(p));
      
      return info;
    } catch (error) {
      logger.error(`Error obteniendo info del sistema de ${vps.name}: ${error.message}`);
      return {
        vpsId: vps.id,
        vpsName: vps.name,
        status: 'error',
        error: error.message
      };
    } finally {
      await this.disconnect(ssh);
    }
  }
}

// ============================================
// SERVICIO DE MANTENIMIENTO
// ============================================
class MaintenanceService extends SSHService {
  async cleanLogs(vps) {
    const ssh = await this.connect(vps);
    
    try {
      const commands = [
        'truncate -s 0 /var/log/auth.log',
        'truncate -s 0 /var/log/syslog',
        'truncate -s 0 /var/log/kern.log',
        'rm -f /var/log/*.gz',
        'rm -f /var/log/*.1',
        'find /var/log/v2ray/ -type f -delete 2>/dev/null || true',
        'find /var/log/xray/ -type f -delete 2>/dev/null || true',
        'find /var/log/nginx/ -type f -name "*.log" -exec truncate -s 0 {} \\; 2>/dev/null || true',
        'find /var/log/apache2/ -type f -name "*.log" -exec truncate -s 0 {} \\; 2>/dev/null || true',
        'history -c'
      ];
      
      for (const cmd of commands) {
        await this.executeCommand(ssh, cmd);
      }
      
      logger.info(`Logs limpiados en ${vps.name}`);
      return true;
    } catch (error) {
      logger.error(`Error limpiando logs en ${vps.name}: ${error.message}`);
      throw error;
    } finally {
      await this.disconnect(ssh);
    }
  }
  
  async restartVps(vps) {
    const ssh = await this.connect(vps);
    
    try {
      await this.executeCommand(ssh, 'reboot');
      logger.info(`Reinicio iniciado en ${vps.name}`);
      return true;
    } catch (error) {
      logger.error(`Error reiniciando ${vps.name}: ${error.message}`);
      throw error;
    } finally {
      await this.disconnect(ssh);
    }
  }
}

// ============================================
// SERVICIO DE VERIFICACIÓN DE LÍMITES
// ============================================
class ConnectionLimitService {
  constructor() {
    this.userSSHService = new UserSSHService();
    this.isChecking = false;
    this.checkTask = null;
  }
  
  async checkAllUsers() {
    if (this.isChecking) {
      logger.info('Verificación ya en progreso, saltando...');
      return;
    }
    
    this.isChecking = true;
    logger.info('Iniciando verificación de límites de conexión...');
    
    try {
      const users = await UserModel.getAll();
      const usersWithLimit = users.filter(u => u.connection_limit && u.status === 'active');
      
      if (usersWithLimit.length === 0) {
        logger.info('No hay usuarios con límite de conexiones para verificar');
        this.isChecking = false;
        return;
      }
      
      // Agrupar por VPS
      const usersByVps = {};
      usersWithLimit.forEach(user => {
        if (!usersByVps[user.vps_id]) {
          usersByVps[user.vps_id] = [];
        }
        usersByVps[user.vps_id].push(user);
      });
      
      // Verificar cada VPS
      for (const [vpsId, vpsUsers] of Object.entries(usersByVps)) {
        const vps = await VpsModel.getById(parseInt(vpsId));
        if (!vps) continue;
        
        try {
          for (const user of vpsUsers) {
            const connections = await this.userSSHService.getConnections(vps, user.username);
            
            if (connections > user.connection_limit) {
              // Excedió el límite, bloquear
              await this.userSSHService.blockUser(vps, user.username);
              await UserModel.updateStatus(
                user.id,
                'blocked',
                `Excedió límite de conexiones (${connections}/${user.connection_limit})`
              );
              
              await LogModel.create(
                'auto_block',
                `Usuario ${user.username} bloqueado automáticamente por exceder límite (${connections}/${user.connection_limit})`,
                vps.id,
                user.id,
                'success'
              );
              
              logger.warn(`Usuario ${user.username} en ${vps.name} bloqueado por exceder límite (${connections}/${user.connection_limit})`);
            }
          }
        } catch (error) {
          logger.error(`Error verificando usuarios en VPS ${vps.name}: ${error.message}`);
        }
        
        // Pequeña pausa entre VPS para no saturar
        await sleep(1000);
      }
      
      logger.info('Verificación de límites completada');
    } catch (error) {
      logger.error(`Error en verificación de límites: ${error.message}`);
    } finally {
      this.isChecking = false;
    }
  }
  
  async start() {
    const enabled = await SettingsModel.get('auto_check_enabled');
    const interval = await SettingsModel.get('check_interval') || 5;
    
    if (enabled === '1') {
      // Ejecutar cada X minutos
      this.checkTask = cron.schedule(`*/${interval} * * * *`, () => {
        this.checkAllUsers();
      });
      
      logger.info(`Sistema de verificación de límites iniciado (cada ${interval} minutos)`);
    } else {
      logger.info('Sistema de verificación de límites desactivado');
    }
  }
  
  async stop() {
    if (this.checkTask) {
      this.checkTask.stop();
      logger.info('Sistema de verificación de límites detenido');
    }
  }
  
  async restart() {
    await this.stop();
    await this.start();
  }
}

module.exports = {
  SSHService,
  UserSSHService,
  MonitorService,
  MaintenanceService,
  ConnectionLimitService
};
