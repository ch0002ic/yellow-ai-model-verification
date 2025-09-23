/**
 * Main entry point for Yellow Network Ideathon Demo
 * Real-Time AI Model Verification using Nitrolite SDK and State Channels
 * 
 * FOCUS: Yellow Network integration with Base Sepolia testnet
 * DEMO: Cross-chain verification with gasless transactions
 */

// Load environment configuration FIRST
import { config } from 'dotenv';
config();

import { logger } from './utils/logger';
import { VerificationNetwork } from './core/VerificationNetwork';
import { StateChannelManager } from './network/StateChannelManager';
import { HttpServer } from './server/HttpServer';
import { enforceEnvironmentValidation, getEnvironmentSummary } from './utils/environmentValidation';

/**
 * Bootstrap the Yellow Network verification demo
 */
async function bootstrap(): Promise<void> {
  logger.info('🚀 Initializing Real-Time AI Model Verification Network');
  
  try {
    // SECURITY: Validate environment before proceeding
    logger.info('🔍 Validating environment configuration...');
    enforceEnvironmentValidation();
    logger.info('✅ Environment validation passed');
    
    // Log safe environment summary
    const envSummary = getEnvironmentSummary();
    logger.info('🔧 Environment configuration:', envSummary);
    
    // Initialize state channel manager with Nitrolite SDK
    const stateChannelManager = new StateChannelManager({
      networkId: process.env.NETWORK_ID!, // Required by validation
      rpcUrl: process.env.RPC_URL!, // Required by validation
      privateKey: process.env.PRIVATE_KEY!, // Required by validation
      chainId: parseInt(process.env.CHAIN_ID || '84532'), // Default to Base Sepolia
      enableGasless: true,
      crossChainEnabled: true
    });
    
    await stateChannelManager.initialize();
    
    // Initialize main verification network
    const verificationNetwork = new VerificationNetwork({
      stateChannelManager
    });
    
    await verificationNetwork.start();
    
    // Initialize and start HTTP server for API access
    const httpServer = new HttpServer({
      verificationNetwork,
      enableCors: true,
      enableCompression: true,
      enableSecurity: true
    });
    
    await httpServer.start();
    
    logger.info('🌐 HTTP Server running');
    logger.info('✅ Verification Network initialized successfully');
    
    // Setup graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('🛑 Graceful shutdown initiated');
      await httpServer.stop();
      await verificationNetwork.stop();
      await stateChannelManager.shutdown();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('❌ Bootstrap failed:', error);
    logger.error('🔧 Please check configuration and restart the service');
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  bootstrap().catch((error) => {
    if (logger && logger.error) {
      logger.error('💥 Fatal error during bootstrap:', error);
    } else {
      console.error('💥 Fatal error during bootstrap:', error);
    }
    process.exit(1);
  });
}