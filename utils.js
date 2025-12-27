const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// ============================================
// SISTEMA DE LOGS
// ============================================
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    }),
    
    // Archivo de logs general con rotación
    new DailyRotateFile({
      filename: path.join(logsDir, 'api-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: process.env.LOG_MAX_SIZE || '10m',
      maxFiles: process.env.LOG_MAX_FILES || '5',
      level: 'info'
    }),
    
    // Archivo solo de errores
    new DailyRotateFile({
      filename: path.join(logsDir, 'errors-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: process.env.LOG_MAX_SIZE || '10m',
      maxFiles: process.env.LOG_MAX_FILES || '5',
      level: 'error'
    }),
    
    // Archivo de operaciones (usuarios, VPS, etc)
    new DailyRotateFile({
      filename: path.join(logsDir, 'operations-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: process.env.LOG_MAX_SIZE || '10m',
      maxFiles: process.env.LOG_MAX_FILES || '5',
      level: 'info'
    })
  ]
});

// ============================================
// GENERADOR DE CONTRASEÑAS
// ============================================
function generatePassword(length = 12) {
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*';
  
  const allChars = lowercase + uppercase + numbers + symbols;
  
  let password = '';
  
  // Asegurar al menos un carácter de cada tipo
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];
  
  // Completar el resto
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Mezclar
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

// ============================================
// HELPERS DE RESPUESTA
// ============================================
const successResponse = (res, data = null, message = 'Operación exitosa', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

const errorResponse = (res, message = 'Error en la operación', statusCode = 500, errors = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    errors
  });
};

// ============================================
// VALIDACIONES
// ============================================
const isValidIP = (ip) => {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;
  
  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part);
    return num >= 0 && num <= 255;
  });
};

const isValidPort = (port) => {
  const portNum = parseInt(port);
  return portNum >= 1 && portNum <= 65535;
};

const isValidUsername = (username) => {
  // Solo alfanuméricos, guiones y guiones bajos
  const usernameRegex = /^[a-z][a-z0-9_-]{2,31}$/;
  return usernameRegex.test(username);
};

// ============================================
// UTILIDADES DE FECHA
// ============================================
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isExpired = (expirationDate) => {
  return new Date(expirationDate) < new Date();
};

// ============================================
// LIMPIEZA DE LOGS ANTIGUOS
// ============================================
const cleanOldLogs = () => {
  const maxDays = parseInt(process.env.LOG_MAX_DAYS) || 30;
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() - maxDays);
  
  fs.readdir(logsDir, (err, files) => {
    if (err) {
      logger.error('Error al leer directorio de logs:', err);
      return;
    }
    
    files.forEach(file => {
      const filePath = path.join(logsDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        
        if (stats.mtime < maxDate) {
          fs.unlink(filePath, (err) => {
            if (!err) {
              logger.info(`Log antiguo eliminado: ${file}`);
            }
          });
        }
      });
    });
  });
};

// ============================================
// INFORMACIÓN DE LOGS
// ============================================
const getLogsInfo = () => {
  return new Promise((resolve, reject) => {
    fs.readdir(logsDir, (err, files) => {
      if (err) {
        reject(err);
        return;
      }
      
      let totalSize = 0;
      let oldest = null;
      
      const promises = files.map(file => {
        return new Promise((res) => {
          const filePath = path.join(logsDir, file);
          fs.stat(filePath, (err, stats) => {
            if (!err) {
              totalSize += stats.size;
              if (!oldest || stats.mtime < oldest) {
                oldest = stats.mtime;
              }
            }
            res();
          });
        });
      });
      
      Promise.all(promises).then(() => {
        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        const daysOld = oldest ? Math.floor((new Date() - oldest) / (1000 * 60 * 60 * 24)) : 0;
        
        resolve({
          totalFiles: files.length,
          totalSizeMB,
          oldestLogDays: daysOld
        });
      });
    });
  });
};

// ============================================
// SLEEP HELPER
// ============================================
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  logger,
  generatePassword,
  successResponse,
  errorResponse,
  isValidIP,
  isValidPort,
  isValidUsername,
  addDays,
  formatDate,
  isExpired,
  cleanOldLogs,
  getLogsInfo,
  sleep
};
