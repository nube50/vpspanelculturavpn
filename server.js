const express = require('express');
const cors = require('cors');
const path = require('path');
const { config, database } = require('./config');
const routes = require('./routes');
const { ConnectionLimitService } = require('./services');
const { 
  errorHandler, 
  requestLogger, 
  notFoundHandler 
} = require('./middleware');
const { logger, cleanOldLogs } = require('./utils');

const app = express();

// ============================================
// MIDDLEWARE GLOBAL
// ============================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// ============================================
// SERVIR ARCHIVOS ESTÁTICOS (FRONTEND)
// ============================================
app.use(express.static(path.join(__dirname, '../frontend')));

// ============================================
// RUTAS DE LA API
// ============================================
app.use('/api', routes);

// ============================================
// RUTA PRINCIPAL (FRONTEND)
// ============================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ============================================
// MANEJO DE RUTAS NO ENCONTRADAS
// ============================================
app.use(notFoundHandler);

// ============================================
// MANEJO DE ERRORES
// ============================================
app.use(errorHandler);

// ============================================
// SERVICIO DE VERIFICACIÓN DE LÍMITES
// ============================================
const connectionLimitService = new ConnectionLimitService();

// ============================================
// INICIALIZAR SERVIDOR
// ============================================
const startServer = async () => {
  try {
    // Conectar base de datos
    await database.connect();
    
    // Limpiar logs antiguos al iniciar
    cleanOldLogs();
    
    // Iniciar servidor
    app.listen(config.port, () => {
      logger.info(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║          🚀 VPS MANAGER API - RUNNING                 ║
║                                                        ║
║  Puerto:      ${config.port}                                    ║
║  Entorno:     ${process.env.NODE_ENV || 'development'}                   ║
║  Base datos:  SQLite                                   ║
║  Usuario:     ${config.adminUsername}                                ║
║                                                        ║
║  API:         http://localhost:${config.port}/api              ║
║  Frontend:    http://localhost:${config.port}                  ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
      `);
      
      // Iniciar sistema de verificación de límites
      connectionLimitService.start();
      
      logger.info('✅ Sistema iniciado correctamente');
    });
  } catch (error) {
    logger.error('❌ Error al iniciar el servidor:', error);
    process.exit(1);
  }
};

// ============================================
// MANEJO DE CIERRE GRACEFUL
// ============================================
const gracefulShutdown = async (signal) => {
  logger.info(`\n${signal} recibido. Cerrando servidor...`);
  
  try {
    // Detener verificación de límites
    await connectionLimitService.stop();
    
    // Cerrar base de datos
    await database.close();
    
    logger.info('✅ Servidor cerrado correctamente');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error al cerrar servidor:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================
// MANEJO DE ERRORES NO CAPTURADOS
// ============================================
process.on('uncaughtException', (error) => {
  logger.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Unhandled Rejection:', reason);
});

// ============================================
// INICIAR
// ============================================
startServer();
