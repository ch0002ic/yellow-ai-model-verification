/**
 * Logger utility with structured logging for AI verification events
 * EVOLUTIONARY PATTERN: Adaptive log levels based on system performance
 * MONITORING: Tracks verification metrics and error patterns
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LogContext {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, unknown>;
  verificationId?: string;
  performanceMetrics?: {
    duration?: number;
    gasUsed?: number;
    throughput?: number;
  };
}

export class Logger {
  private logDir: string;
  private logFile: string;
  private evolutionaryMode: boolean;
  private rateLimitMap: Map<string, { count: number; lastReset: number }> = new Map();
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly RATE_LIMIT_MAX = 100; // Max 100 identical messages per minute

  constructor(evolutionaryMode = true) {
    this.evolutionaryMode = evolutionaryMode;
    this.logDir = path.join(process.cwd(), 'logs');
    this.logFile = path.join(this.logDir, `verification-${new Date().toISOString().split('T')[0]}.log`);
    
    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private createLogContext(level: LogContext['level'], message: string, metadata?: Record<string, unknown>): LogContext {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata
    };
  }

  private writeLog(context: LogContext): void {
    // Rate limiting check
    const messageKey = `${context.level}:${context.message}`;
    const now = Date.now();
    const rateLimitEntry = this.rateLimitMap.get(messageKey);

    if (rateLimitEntry) {
      // Reset counter if window has passed
      if (now - rateLimitEntry.lastReset > this.RATE_LIMIT_WINDOW) {
        rateLimitEntry.count = 0;
        rateLimitEntry.lastReset = now;
      }

      // Check if rate limit exceeded
      if (rateLimitEntry.count >= this.RATE_LIMIT_MAX) {
        // Suppress this log entry
        return;
      }

      rateLimitEntry.count++;
    } else {
      // First occurrence of this message
      this.rateLimitMap.set(messageKey, { count: 1, lastReset: now });
    }

    const logEntry = JSON.stringify(context) + '\n';
    
    // Console output with colors
    const colors = {
      info: '\x1b[36m',    // Cyan
      warn: '\x1b[33m',    // Yellow
      error: '\x1b[31m',   // Red
      debug: '\x1b[37m'    // White
    };
    
    const reset = '\x1b[0m';
    
    // For warnings and errors, include key metadata in console output
    let consoleMessage = context.message;
    if ((context.level === 'warn' || context.level === 'error') && context.metadata) {
      const keyInfo = [];
      if (context.metadata.error) keyInfo.push(`Error: ${context.metadata.error}`);
      if (context.metadata.errorType) keyInfo.push(`Type: ${context.metadata.errorType}`);
      if (context.metadata.recommendation) keyInfo.push(`Recommendation: ${context.metadata.recommendation}`);
      
      if (keyInfo.length > 0) {
        consoleMessage += ` [${keyInfo.join(' | ')}]`;
      }
    }
    
    console.log(`${colors[context.level]}[${context.level.toUpperCase()}] ${context.timestamp} - ${consoleMessage}${reset}`);
    
    // File output
    try {
      fs.appendFileSync(this.logFile, logEntry);
      
      // Check for log rotation (if file > 100MB, archive it)
      this.checkLogRotation();
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private checkLogRotation(): void {
    try {
      const stats = fs.statSync(this.logFile);
      const maxSize = 100 * 1024 * 1024; // 100MB
      
      if (stats.size > maxSize) {
        const archiveFile = `${this.logFile}.${Date.now()}.archived`;
        fs.renameSync(this.logFile, archiveFile);
        console.warn(`Log file rotated: ${archiveFile}`);
      }
    } catch (error) {
      // Ignore rotation errors
    }
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.writeLog(this.createLogContext('info', message, metadata));
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.writeLog(this.createLogContext('warn', message, metadata));
  }

  error(message: string, error?: Error | unknown, metadata?: Record<string, unknown>): void {
    const errorMetadata = {
      ...metadata,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    };
    this.writeLog(this.createLogContext('error', message, errorMetadata));
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    if (process.env.NODE_ENV === 'development' || this.evolutionaryMode) {
      this.writeLog(this.createLogContext('debug', message, metadata));
    }
  }

  /**
   * Log verification-specific events with performance metrics
   * EVOLUTIONARY: Adapts logging based on verification patterns
   */
  verification(message: string, verificationId: string, performanceMetrics?: LogContext['performanceMetrics'], metadata?: Record<string, unknown>): void {
    const context = this.createLogContext('info', message, metadata);
    context.verificationId = verificationId;
    context.performanceMetrics = performanceMetrics;
    
    this.writeLog(context);
    
    // EVOLUTIONARY: Alert if performance degrades
    if (performanceMetrics?.duration && performanceMetrics.duration > 1000) {
      this.warn(`Verification ${verificationId} exceeded 1s target: ${performanceMetrics.duration}ms`);
    }
  }
}

// Export singleton instance
export const logger = new Logger(process.env.NODE_ENV !== 'production');