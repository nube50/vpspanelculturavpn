const express = require('express');
const {
  AuthController,
  VpsController,
  UserController,
  MaintenanceController,
  SettingsController,
  DashboardController
} = require('./controllers');
const {
  authMiddleware,
  validateVpsData,
  validateUserData
} = require('./middleware');

const router = express.Router();

// ============================================
// RUTAS DE AUTENTICACIÓN (públicas)
// ============================================
router.post('/auth/login', AuthController.login);

// ============================================
// RUTAS PROTEGIDAS (requieren autenticación)
// ============================================

// Auth
router.post('/auth/change-password', authMiddleware, AuthController.changePassword);

// Dashboard
router.get('/dashboard/stats', authMiddleware, DashboardController.getStats);

// VPS
router.get('/vps', authMiddleware, VpsController.getAll);
router.get('/vps/:id', authMiddleware, VpsController.getById);
router.post('/vps', authMiddleware, validateVpsData, VpsController.create);
router.put('/vps/:id', authMiddleware, VpsController.update);
router.delete('/vps/:id', authMiddleware, VpsController.delete);
router.get('/vps/:id/status', authMiddleware, VpsController.getStatus);
router.get('/vps-status/all', authMiddleware, VpsController.getAllStatus);

// Usuarios SSH
router.get('/users', authMiddleware, UserController.getAll);
router.post('/users', authMiddleware, validateUserData, UserController.create);
router.put('/users/:id', authMiddleware, UserController.update);
router.delete('/users/:id', authMiddleware, UserController.delete);
router.post('/users/:id/renew', authMiddleware, UserController.renew);
router.post('/users/:id/block', authMiddleware, UserController.block);
router.post('/users/:id/unblock', authMiddleware, UserController.unblock);
router.get('/users/:id/connections', authMiddleware, UserController.getConnections);

// Mantenimiento
router.post('/maintenance/clean-logs', authMiddleware, MaintenanceController.cleanLogs);
router.post('/maintenance/restart-vps', authMiddleware, MaintenanceController.restartVps);
router.post('/maintenance/check-expired', authMiddleware, MaintenanceController.checkExpired);

// Configuración
router.get('/settings', authMiddleware, SettingsController.get);
router.put('/settings', authMiddleware, SettingsController.update);

module.exports = router;
