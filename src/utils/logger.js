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
 * Log error message
 * @param {string} message
 * @param {any} data - Additional data to log
 */
export const error = (message, data = null) => {
    if (!shouldLog(LOG_LEVELS.ERROR)) return;

    const timestamp = getTimestamp();
    console.group(
        `%c[${timestamp}] %c[ERROR]%c ${message}`,
        STYLES.timestamp,
        STYLES.error,
        STYLES.message
    );
    if (data) console.error(data);
    console.trace();
    console.groupEnd();
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
    api,
    getConfig,
    LOG_LEVELS
};
