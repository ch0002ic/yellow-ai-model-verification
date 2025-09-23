/**
 * Environment Configuration - Centralized configuration management
 * PRODUCTION-READY: Comprehensive environment variable system with validation
 * DEPLOYMENT-FRIENDLY: Support for development, staging, and production environments
 */

export interface EnvironmentConfig {
  // Server Configuration
  server: {
    port: number;
    host: string;
    apiPrefix: string;
  };
  
  // Network Configuration
  network: {
    blockchainRpcUrl: string;
    blockchainPort: number;
    metricsPort: number;
    networkId: string;
  };
  
  // Performance Configuration
  performance: {
    maxConcurrentVerifications: number;
    processingIntervalMs: number;
    requestTimeoutMs: number;
    shutdownTimeoutMs: number;
  };
  
  // Monitoring Configuration
  monitoring: {
    prometheusPort: number;
    grafanaPort: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    enableMetrics: boolean;
  };
  
  // Logging Configuration
  logging: {
    maxFileSize: number;
    maxFiles: number;
    maxAge: number;
    rotationEnabled: boolean;
  };
  development: {
    enableHotReload: boolean;
    simulationMode: boolean;
    debugMode: boolean;
  };
}

/**
 * Load and validate environment configuration
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
  const config: EnvironmentConfig = {
    server: {
      port: parseInt(process.env.SERVER_PORT || '3000', 10),
      host: process.env.SERVER_HOST || 'localhost',
      apiPrefix: process.env.API_PREFIX || '/api'
    },
    
    network: {
      blockchainRpcUrl: process.env.BLOCKCHAIN_RPC_URL || 'http://localhost:8545',
      blockchainPort: parseInt(process.env.BLOCKCHAIN_PORT || '8545', 10),
      metricsPort: parseInt(process.env.METRICS_PORT || '9090', 10),
      networkId: process.env.NETWORK_ID || 'localhost'
    },
    
    performance: {
      maxConcurrentVerifications: parseInt(process.env.MAX_CONCURRENT_VERIFICATIONS || '50', 10),
      processingIntervalMs: parseInt(process.env.PROCESSING_INTERVAL_MS || '100', 10),
      requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10),
      shutdownTimeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000', 10)
    },
    
    monitoring: {
      prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9091', 10),
      grafanaPort: parseInt(process.env.GRAFANA_PORT || '3001', 10),
      logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined) || 'info',
      enableMetrics: process.env.ENABLE_METRICS !== 'false'
    },
    
    development: {
      enableHotReload: process.env.HOT_RELOAD === 'true',
      simulationMode: process.env.ENABLE_SIMULATION_MODE === 'true',
      debugMode: process.env.DEBUG_MODE === 'true' || process.env.NODE_ENV === 'development'
    },
    
    logging: {
      maxFileSize: parseInt(process.env.LOG_MAX_FILE_SIZE || '104857600', 10), // 100MB default
      maxFiles: parseInt(process.env.LOG_MAX_FILES || '10', 10),
      maxAge: parseInt(process.env.LOG_MAX_AGE_DAYS || '7', 10),
      rotationEnabled: process.env.LOG_ROTATION_ENABLED !== 'false'
    }
  };
  
  // Validation
  validateConfig(config);
  
  return config;
}

/**
 * Validate configuration values
 */
function validateConfig(config: EnvironmentConfig): void {
  const errors: string[] = [];
  
  // Validate ports
  if (config.server.port < 1 || config.server.port > 65535) {
    errors.push(`Invalid server port: ${config.server.port}`);
  }
  
  if (config.network.blockchainPort < 1 || config.network.blockchainPort > 65535) {
    errors.push(`Invalid blockchain port: ${config.network.blockchainPort}`);
  }
  
  if (config.network.metricsPort < 1 || config.network.metricsPort > 65535) {
    errors.push(`Invalid metrics port: ${config.network.metricsPort}`);
  }
  
  // Validate performance settings
  if (config.performance.maxConcurrentVerifications < 1) {
    errors.push(`Max concurrent verifications must be at least 1`);
  }
  
  if (config.performance.processingIntervalMs < 10) {
    errors.push(`Processing interval must be at least 10ms`);
  }
  
  if (config.performance.requestTimeoutMs < 1000) {
    errors.push(`Request timeout must be at least 1000ms`);
  }
  
  // Validate log level
  const validLogLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLogLevels.includes(config.monitoring.logLevel)) {
    errors.push(`Invalid log level: ${config.monitoring.logLevel}`);
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

/**
 * Get environment-specific configuration overrides
 */
export function getEnvironmentOverrides(): {
  server?: Partial<EnvironmentConfig['server']>;
  network?: Partial<EnvironmentConfig['network']>;
  performance?: Partial<EnvironmentConfig['performance']>;
  monitoring?: Partial<EnvironmentConfig['monitoring']>;
  development?: Partial<EnvironmentConfig['development']>;
} {
  const env = process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return {
        server: {
          host: '0.0.0.0', // Listen on all interfaces in production
          port: parseInt(process.env.PORT || '3000', 10)
        },
        performance: {
          maxConcurrentVerifications: 100,
          processingIntervalMs: 50
        },
        monitoring: {
          logLevel: 'info',
          enableMetrics: true
        },
        development: {
          enableHotReload: false,
          simulationMode: false,
          debugMode: false
        }
      };
      
    case 'staging':
      return {
        monitoring: {
          logLevel: 'debug',
          enableMetrics: true
        },
        development: {
          simulationMode: true,
          debugMode: true
        }
      };
      
    case 'test':
      return {
        server: {
          port: 0 // Use random available port for tests
        },
        monitoring: {
          logLevel: 'warn',
          enableMetrics: false
        },
        development: {
          simulationMode: true,
          debugMode: true
        }
      };
      
    default: // development
      return {
        monitoring: {
          logLevel: 'debug',
          enableMetrics: true
        },
        development: {
          enableHotReload: true,
          simulationMode: true,
          debugMode: true
        }
      };
  }
}

/**
 * Create final configuration with environment overrides
 */
export function createFinalConfig(): EnvironmentConfig {
  const baseConfig = loadEnvironmentConfig();
  const overrides = getEnvironmentOverrides();
  
  // Deep merge configuration with proper type safety
  const finalConfig: EnvironmentConfig = {
    server: { 
      ...baseConfig.server, 
      ...(overrides.server || {}) 
    },
    network: { 
      ...baseConfig.network, 
      ...(overrides.network || {}) 
    },
    performance: { 
      ...baseConfig.performance, 
      ...(overrides.performance || {}) 
    },
    monitoring: { 
      ...baseConfig.monitoring, 
      ...(overrides.monitoring || {}) 
    },
    development: { 
      ...baseConfig.development, 
      ...(overrides.development || {}) 
    },
    logging: {
      ...baseConfig.logging
    }
  };
  
  return finalConfig;
}

// Export singleton instance
export const config = createFinalConfig();