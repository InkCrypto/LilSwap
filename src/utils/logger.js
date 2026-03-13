import { logSessionService } from '../services/logSessionService';

/**
 * Native Frontend Logging System
 * Configurable log levels via environment variables
 * No external dependencies required
 */

/**
 * Log levels in order of severity
 * @enum {string}
 */
const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug'
};

/**
 * Log level priorities (lower number = higher priority)
 */
const LOG_PRIORITY = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

/**
 * CSS styles for console output
 */
const STYLES = {
    error: 'color: #ff4444; font-weight: bold;',
    warn: 'color: #ffaa00; font-weight: bold;',
    info: 'color: #4488ff; font-weight: bold;',
    debug: 'color: #888888;',
    timestamp: 'color: #666666; font-size: 0.9em;',
    message: 'color: inherit;'
};

/**
 * Get current log level from environment
 * Defaults: production = 'error', development = 'debug'
 * Prioritizes explicit VITE_LOG_LEVEL setting over MODE detection
 */
const getCurrentLogLevel = () => {
    // Priority 1: Explicit VITE_LOG_LEVEL env var
    const envLevel = import.meta.env.VITE_LOG_LEVEL?.toLowerCase();
    if (envLevel && LOG_PRIORITY.hasOwnProperty(envLevel)) {
        return envLevel;
    }

    // Priority 2: Check MODE explicitly (production mode should be 'error')
    if (import.meta.env.MODE === 'production') {
        return LOG_LEVELS.ERROR;
    }

    // Priority 3: Legacy PROD check
    if (import.meta.env.PROD === true) {
        return LOG_LEVELS.ERROR;
    }

    // Default: development = debug
    return LOG_LEVELS.DEBUG;
};

const currentLevel = getCurrentLogLevel();
const currentPriority = LOG_PRIORITY[currentLevel];

/**
 * Detects if an error is a user-driven cancellation/rejection.
 * This is expected behavior and should not be treated as a critical error.
 * @param {any} error
 * @returns {boolean}
 */
export const isUserRejectedError = (error) => {
    if (!error) return false;

    const code = error?.code ?? error?.error?.code;
    const name = String(error?.name || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    const reason = String(error?.reason || '').toLowerCase();

    return (
        code === 4001 ||
        code === '4001' ||
        code === 'ACTION_REJECTED' ||
        code === 'USER_REJECTED' ||
        code === 'ERR_CANCELED' ||
        name === 'cancelederror' ||
        name === 'aborterror' ||
        message.includes('user rejected') ||
        message.includes('user denied') ||
        message.includes('rejected the request') ||
        message === 'canceled' ||
        reason.includes('rejected')
    );
};

/**
 * Check if a log level should be displayed
 * @param {string} level - Log level to check
 * @returns {boolean}
 */
const shouldLog = (level) => {
    return LOG_PRIORITY[level] <= currentPriority;
};

/**
 * Get current log level (public API for checking if debug level is enabled)
 * @returns {string}
 */
export const getLogLevel = () => {
    return currentLevel;
};

/**
 * Format timestamp
 * @returns {string}
 */
const getTimestamp = () => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
};

/**
 * Relay log to backend for persistent storage
 */
const relayLogToBackend = async (level, message, data) => {
    // Skip user rejections as they are not errors we need to track centrally
    if (isUserRejectedError(data)) return;

    try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/v1';
        
        // Extract useful info from Error objects
        let stack = null;
        let meta = {};
        
        if (data instanceof Error) {
            stack = data.stack;
            meta = { name: data.name, code: data.code };
        } else if (typeof data === 'object' && data !== null) {
            meta = data;
        } else {
            meta = { raw: data };
        }

        // Add additional context
        const url = window.location.href;
        const userAddress = meta.userAddress || meta.walletAddress || null;
        
        const payload = {
            level,
            message,
            meta,
            stack,
            url,
            userAddress
        };

        // Sign the payload
        const { signature, timestamp, sessionId } = await logSessionService.signPayload(payload);

        // Non-blocking fetch
        fetch(`${apiUrl}/logs`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Log-Session-Id': sessionId,
                'X-Log-Signature': signature,
                'X-Log-Timestamp': timestamp
            },
            body: JSON.stringify(payload)
        }).then(res => {
            if (res.status === 401 || res.status === 429) {
                // If unauthorized or limit reached, reset session so it re-handshakes next time
                logSessionService.reset();
            }
        }).catch(() => {
            // Silently fail if backend logging fails to avoid console noise
        });
    } catch (err) {
        // unreachable in most browsers for fetch but safe to have
    }
};

/**
 * Log error message
 * @param {string} message
 * @param {any} data - Additional data to log
 */
export const error = (message, data = null) => {
    if (!shouldLog(LOG_LEVELS.ERROR)) return;

    const isDebugEnabled = shouldLog(LOG_LEVELS.DEBUG);
    const timestamp = getTimestamp();
    console.group(
        `%c[${timestamp}] %c[ERROR]%c ${message}`,
        STYLES.timestamp,
        STYLES.error,
        STYLES.message
    );

    if (data) {
        if (isDebugEnabled) {
            console.error(data);
        } else if (data instanceof Error) {
            console.error({
                name: data.name,
                code: data.code,
                message: data.message,
            });
        } else if (typeof data === 'object' && data !== null) {
            const minimal = {
                code: data.code,
                message: data.message,
            };
            if (minimal.code || minimal.message) {
                console.error(minimal);
            } else {
                console.error(data);
            }
        } else {
            console.error(data);
        }
    }

    if (isDebugEnabled) {
        console.trace();
    }

    console.groupEnd();

    // Relay to backend
    relayLogToBackend(LOG_LEVELS.ERROR, message, data);
};

/**
 * Log warning message
 * @param {string} message
 * @param {any} data - Additional data to log
 */
export const warn = (message, data = null) => {
    if (!shouldLog(LOG_LEVELS.WARN)) return;

    const timestamp = getTimestamp();
    console.log(
        `%c[${timestamp}] %c[WARN]%c ${message}`,
        STYLES.timestamp,
        STYLES.warn,
        STYLES.message
    );
    if (data) console.warn(data);

    // Relay to backend
    relayLogToBackend(LOG_LEVELS.WARN, message, data);
};

/**
 * Log info message
 * @param {string} message
 * @param {any} data - Additional data to log
 */
export const info = (message, data = null) => {
    if (!shouldLog(LOG_LEVELS.INFO)) return;

    const timestamp = getTimestamp();
    console.log(
        `%c[${timestamp}] %c[INFO]%c ${message}`,
        STYLES.timestamp,
        STYLES.info,
        STYLES.message
    );
    if (data) console.log(data);
};

/**
 * Log debug message
 * @param {string} message
 * @param {any} data - Additional data to log
 */
export const debug = (message, data = null) => {
    if (!shouldLog(LOG_LEVELS.DEBUG)) return;

    const timestamp = getTimestamp();
    console.log(
        `%c[${timestamp}] %c[DEBUG]%c ${message}`,
        STYLES.timestamp,
        STYLES.debug,
        STYLES.message
    );
    if (data) console.log(data);
};

/**
 * Log API request
 * @param {string} method
 * @param {string} url
 * @param {any} data
 */
export const api = (method, url, data = null) => {
    if (!shouldLog(LOG_LEVELS.DEBUG)) return;

    const timestamp = getTimestamp();
    console.group(
        `%c[${timestamp}] %c[API]%c ${method.toUpperCase()} ${url}`,
        STYLES.timestamp,
        'color: #00aa88; font-weight: bold;',
        STYLES.message
    );
    if (data) console.log('Data:', data);
    console.groupEnd();
};

/**
 * Get current log level configuration
 * @returns {Object}
 */
export const getConfig = () => ({
    level: currentLevel,
    priority: currentPriority,
    environment: import.meta.env.MODE,
    isDev: import.meta.env.DEV,
    isProd: import.meta.env.PROD
});

// Log initialization (only in debug mode)
// Using logger's own debug method to respect level filtering
if (currentLevel === LOG_LEVELS.DEBUG) {
    // Defer initialization log to avoid direct console usage
    setTimeout(() => {
        if (shouldLog(LOG_LEVELS.DEBUG)) {
            console.log(
                '%c[Logger] Initialized',
                'color: #00aa88; font-weight: bold;',
                `Level: ${currentLevel.toUpperCase()}, Mode: ${import.meta.env.MODE}`
            );
        }
    }, 0);
}

export default {
    error,
    warn,
    info,
    debug,
    isUserRejectedError,
    api,
    getConfig,
    LOG_LEVELS
};
