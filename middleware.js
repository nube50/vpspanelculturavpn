const jwt = require('jsonwebtoken');
const { config } = require('./config');
const { logger, errorResponse } = require('./utils');

// ============================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return errorResponse(res, 'Token no proporcionado', 401);
    }
    
    const token = authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
      return errorResponse(res, 'Formato de token inválido', 401);
    }
    
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return errorResponse(res, 'Token expirado', 401);
    }
    if (error.name === 'JsonWebTokenError') {
      return errorResponse(res, 'Token inválido', 401);
    }
    return errorResponse(res, 'Error de autenticación', 401);
  }
};

// ============================================
// MIDDLEWARE DE MANEJO DE ERRORES
// ============================================
const errorHandler = (err, req, res, next) => {
  logger.error('Error capturado:', err);
  
  // Error de validación
  if (err.name === 'ValidationError') {
    return errorResponse(res, 'Error de validación', 400, err.errors);
  }
  
  // Error de base de datos
  if (err.code === 'SQLITE_CONSTRAINT') {
    return errorResponse(res, 'Conflicto con datos existentes', 409);
  }
  
  // Error de SSH
  if (err.message && err.message.includes('SSH')) {
    return errorResponse(res, 'Error de conexión SSH', 500, err.message);
  }
  
  // Error genérico
  return errorResponse(res, err.message || 'Error interno del servidor', 500);
};

// ============================================
// MIDDLEWARE DE LOGGING DE REQUESTS
// ============================================
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logMessage = `${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`;
    
    if (res.statusCode >= 400) {
      logger.warn(logMessage);
    } else {
      logger.info(logMessage);
    }
  });
  
  next();
};

// ============================================
// MIDDLEWARE DE VALIDACIÓN DE VPS
// ============================================
const validateVpsData = (req, res, next) => {
  const { name, ip, port, ssh_user, ssh_password } = req.body;
  
  const errors = [];
  
  if (!name || name.trim().length === 0) {
    errors.push('El nombre de la VPS es requerido');
  }
  
  if (!ip || ip.trim().length === 0) {
    errors.push('La IP es requerida');
  }
  
  if (port && (isNaN(port) || port < 1 || port > 65535)) {
    errors.push('Puerto inválido (debe estar entre 1 y 65535)');
  }
  
  if (!ssh_user || ssh_user.trim().length === 0) {
    errors.push('El usuario SSH es requerido');
  }
  
  if (!ssh_password || ssh_password.trim().length === 0) {
    errors.push('La contraseña SSH es requerida');
  }
  
  if (errors.length > 0) {
    return errorResponse(res, 'Datos de VPS inválidos', 400, errors);
  }
  
  next();
};

// ============================================
// MIDDLEWARE DE VALIDACIÓN DE USUARIO SSH
// ============================================
const validateUserData = (req, res, next) => {
  const { username, password, days, vps_ids } = req.body;
  
  const errors = [];
  
  if (!username || username.trim().length === 0) {
    errors.push('El nombre de usuario es requerido');
  }
  
  if (username && !/^[a-z][a-z0-9_-]{2,31}$/.test(username)) {
    errors.push('Nombre de usuario inválido (3-32 caracteres, solo minúsculas, números, guiones)');
  }
  
  if (!password || password.trim().length < 6) {
    errors.push('La contraseña debe tener al menos 6 caracteres');
  }
  
  if (!days || isNaN(days) || days < 1) {
    errors.push('Los días de validez deben ser un número mayor a 0');
  }
  
  if (!vps_ids || !Array.isArray(vps_ids) || vps_ids.length === 0) {
    errors.push('Debe seleccionar al menos una VPS');
  }
  
  if (errors.length > 0) {
    return errorResponse(res, 'Datos de usuario inválidos', 400, errors);
  }
  
  next();
};

// ============================================
// MIDDLEWARE NOT FOUND
// ============================================
const notFoundHandler = (req, res) => {
  errorResponse(res, `Ruta no encontrada: ${req.originalUrl}`, 404);
};

module.exports = {
  authMiddleware,
  errorHandler,
  requestLogger,
  validateVpsData,
  validateUserData,
  notFoundHandler
};
