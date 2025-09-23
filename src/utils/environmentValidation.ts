/**
 * Environment Validation Utility
 * Ensures all required environment variables are present and valid before startup
 * SECURITY: Prevents application from running with missing or default values
 */

import { logger } from './logger';

export interface EnvironmentValidationError {
  variable: string;
  issue: string;
  severity: 'error' | 'warning';
}

export interface EnvironmentValidationResult {
  isValid: boolean;
  errors: EnvironmentValidationError[];
  warnings: EnvironmentValidationError[];
}

/**
 * Required environment variables for production deployment
 */
const REQUIRED_VARIABLES = {
  // Security - Critical
  PRIVATE_KEY: {
    required: true,
    validator: (value: string) => {
      if (!value || value.length < 64) return 'Private key must be at least 64 characters';
      
      // Check for common test/default patterns without hardcoding them
      const testPatterns = ['0x1234', '0xtest', '0xdead', '0xbeef'];
      const isTestKey = testPatterns.some(pattern => value.toLowerCase().startsWith(pattern.toLowerCase()));
      
      if (isTestKey) {
        return 'Cannot use test/default private key in production';
      }
      if (!value.startsWith('0x')) return 'Private key must start with 0x';
      return null;
    }
  },
  
  // Network Configuration - Critical
  RPC_URL: {
    required: true,
    validator: (value: string) => {
      if (!value) return 'RPC URL is required';
      if (value.includes('localhost') && process.env.NODE_ENV === 'production') {
        return 'Cannot use localhost RPC URL in production';
      }
      if (!value.startsWith('http')) return 'RPC URL must start with http or https';
      return null;
    }
  },

  NETWORK_ID: {
    required: true,
    validator: (value: string) => {
      if (!value) return 'Network ID is required';
      if (value === 'localhost' && process.env.NODE_ENV === 'production') {
        return 'Cannot use localhost network ID in production';
      }
      return null;
    }
  },

  // Nitrolite SDK Contract Addresses - Optional for development mode
  CUSTODY_CONTRACT_ADDRESS: {
    required: false,
    validator: (value: string) => {
      if (value && !value.startsWith('0x')) return 'Contract address must start with 0x';
      if (value && value.length !== 42) return 'Contract address must be 42 characters long';
      return null;
    }
  },

  GUEST_CONTRACT_ADDRESS: {
    required: false,
    validator: (value: string) => {
      if (value && !value.startsWith('0x')) return 'Contract address must start with 0x';
      if (value && value.length !== 42) return 'Contract address must be 42 characters long';
      return null;
    }
  },

  ADJUDICATOR_CONTRACT_ADDRESS: {
    required: false,
    validator: (value: string) => {
      if (value && !value.startsWith('0x')) return 'Contract address must start with 0x';
      if (value && value.length !== 42) return 'Contract address must be 42 characters long';
      return null;
    }
  },

  // Additional Configuration - Optional
  PORT: {
    required: false,
    validator: (value: string) => {
      if (value && isNaN(parseInt(value))) return 'Port must be a number';
      const port = parseInt(value);
      if (port < 1000 || port > 65535) return 'Port must be between 1000 and 65535';
      return null;
    }
  },

  CHAIN_ID: {
    required: false,
    validator: (value: string) => {
      if (value && isNaN(parseInt(value))) return 'Chain ID must be a number';
      return null;
    }
  }
};

/**
 * Validate all environment variables according to requirements
 */
export function validateEnvironment(): EnvironmentValidationResult {
  const errors: EnvironmentValidationError[] = [];
  const warnings: EnvironmentValidationError[] = [];

  logger.info('🔍 Validating environment configuration...');

  for (const [variable, config] of Object.entries(REQUIRED_VARIABLES)) {
    const value = process.env[variable];

    // Check if required variable is missing
    if (config.required && !value) {
      errors.push({
        variable,
        issue: 'Required environment variable is missing',
        severity: 'error'
      });
      continue;
    }

    // Skip validation if variable is not present and not required
    if (!value && !config.required) {
      continue;
    }

    // Run custom validation if present
    if (value && config.validator) {
      const validationError = config.validator(value);
      if (validationError) {
        errors.push({
          variable,
          issue: validationError,
          severity: 'error'
        });
      }
    }
  }

  // Additional warnings for development configuration
  if (!process.env.CUSTODY_CONTRACT_ADDRESS || !process.env.GUEST_CONTRACT_ADDRESS || !process.env.ADJUDICATOR_CONTRACT_ADDRESS) {
    warnings.push({
      variable: 'CONTRACT_ADDRESSES',
      issue: 'Nitrolite SDK contract addresses not configured - SDK will operate in compatibility mode for ideathon demo',
      severity: 'warning'
    });
  }

  const isValid = errors.length === 0;

  if (isValid) {
    logger.info('✅ Environment validation passed');
  } else {
    logger.error('❌ Environment validation failed:');
    errors.forEach(error => {
      logger.error(`  - ${error.variable}: ${error.issue}`);
    });
  }

  if (warnings.length > 0) {
    warnings.forEach(warning => {
      logger.warn(`⚠️ ${warning.variable}: ${warning.issue}`);
    });
  }

  return {
    isValid,
    errors,
    warnings
  };
}

/**
 * Enforce environment validation - throws error if validation fails
 */
export function enforceEnvironmentValidation(): void {
  const result = validateEnvironment();
  
  if (!result.isValid) {
    logger.error('🛑 Application cannot start with invalid environment configuration');
    logger.error('💡 Please check your .env file and ensure all required variables are set correctly');
    process.exit(1);
  }

  // Log configuration summary (without sensitive data)
  logger.info('🔧 Environment configuration:', {
    networkId: process.env.NETWORK_ID,
    chainId: process.env.CHAIN_ID,
    rpcConfigured: !!process.env.RPC_URL,
    contractsConfigured: !!(process.env.CUSTODY_CONTRACT_ADDRESS && process.env.GUEST_CONTRACT_ADDRESS && process.env.ADJUDICATOR_CONTRACT_ADDRESS),
    port: process.env.PORT || '3000'
  });
}

/**
 * Get safe environment summary for logging
 */
export function getEnvironmentSummary(): Record<string, unknown> {
  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    networkId: process.env.NETWORK_ID,
    chainId: process.env.CHAIN_ID,
    port: process.env.PORT || '3000',
    rpcConfigured: !!process.env.RPC_URL,
    privateKeyConfigured: !!process.env.PRIVATE_KEY,
    contractsConfigured: !!(process.env.CUSTODY_CONTRACT_ADDRESS && process.env.GUEST_CONTRACT_ADDRESS && process.env.ADJUDICATOR_CONTRACT_ADDRESS),
    gaslessEnabled: process.env.GASLESS_ENABLED === 'true',
    crossChainEnabled: process.env.CROSS_CHAIN_ENABLED === 'true'
  };
}