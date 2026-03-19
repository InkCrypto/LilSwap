import { logSessionService } from '../services/log-session-service';

/**
 * Native Frontend Logging System
 */

const LOG_LEVELS = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug'
} as const;

type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];

const LOG_PRIORITY: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

const STYLES = {
    error: 'color: #ff4444; font-weight: bold;',
    warn: 'color: #ffaa00; font-weight: bold;',
    info: 'color: #4488ff; font-weight: bold;',
    debug: 'color: #888888;',
    timestamp: 'color: #666666; font-size: 0.9em;',
    message: 'color: inherit;'
};

const getCurrentLogLevel = (): LogLevel => {
    const envLevel = (import.meta as any).env.VITE_LOG_LEVEL?.toLowerCase();

    if (envLevel && Object.hasOwn(LOG_PRIORITY, envLevel)) {
        return envLevel as LogLevel;
    }

    if ((import.meta as any).env.MODE === 'production') {
        return LOG_LEVELS.ERROR;
    }

    return LOG_LEVELS.DEBUG;
};

const currentLevel = getCurrentLogLevel();
const currentPriority = LOG_PRIORITY[currentLevel];

export const isUserRejectedError = (error: any): boolean => {
    if (!error) {
        return false;
    }

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

const shouldLog = (level: LogLevel): boolean => {
    return LOG_PRIORITY[level] <= currentPriority;
};

const getTimestamp = (): string => {
    const now = new Date();

    return now.toISOString().split('T')[1].replace('Z', '');
};

const relayLogToBackend = async (level: LogLevel, message: string, data: any) => {
    if (isUserRejectedError(data)) {
        return;
    }

    try {
        const apiUrl = (import.meta as any).env.VITE_API_URL || '/api';

        let stack = null;
        let meta: any = {};

        if (data instanceof Error) {
            stack = data.stack;
            meta = { name: data.name, code: (data as any).code };
        } else if (typeof data === 'object' && data !== null) {
            meta = data;
        } else {
            meta = { raw: data };
        }

        const payload = {
            level,
            message,
            meta,
            stack,
            url: window.location.href,
            userAddress: meta.userAddress || meta.walletAddress || null
        };

        const signingData = await logSessionService.signPayload(payload);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        if (csrfToken) {
            headers['X-CSRF-TOKEN'] = csrfToken;
            headers['X-Requested-With'] = 'XMLHttpRequest';
        }

        if (signingData) {
            headers['X-Log-Signature'] = signingData.signature;
            headers['X-Log-Timestamp'] = signingData.timestamp;
        }

        fetch(`${apiUrl}/logs`, {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        }).catch(() => {
            // Best-effort logging relay.
        });
    } catch {
        // Ignore relay setup errors.
    }
};

export const error = (message: string, data: any = null) => {
    if (!shouldLog(LOG_LEVELS.ERROR)) {
        return;
    }

    const timestamp = getTimestamp();
    console.group(`%c[${timestamp}] %c[ERROR]%c ${message}`, STYLES.timestamp, STYLES.error, STYLES.message);

    if (data) {
        console.error(data);
    }

    console.groupEnd();
    relayLogToBackend(LOG_LEVELS.ERROR, message, data);
};

export const warn = (message: string, data: any = null) => {
    if (!shouldLog(LOG_LEVELS.WARN)) {
        return;
    }

    const timestamp = getTimestamp();
    console.log(`%c[${timestamp}] %c[WARN]%c ${message}`, STYLES.timestamp, STYLES.warn, STYLES.message);

    if (data) {
        console.warn(data);
    }

    relayLogToBackend(LOG_LEVELS.WARN, message, data);
};

export const info = (message: string, data: any = null) => {
    if (!shouldLog(LOG_LEVELS.INFO)) {
        return;
    }

    const timestamp = getTimestamp();
    console.log(`%c[${timestamp}] %c[INFO]%c ${message}`, STYLES.timestamp, STYLES.info, STYLES.message);

    if (data) {
        console.log(data);
    }
};

export const debug = (message: string, data: any = null) => {
    if (!shouldLog(LOG_LEVELS.DEBUG)) {
        return;
    }

    const timestamp = getTimestamp();
    console.log(`%c[${timestamp}] %c[DEBUG]%c ${message}`, STYLES.timestamp, STYLES.debug, STYLES.message);

    if (data) {
        console.log(data);
    }
};

export const api = (method: string, url: string, data: any = null) => {
    if (!shouldLog(LOG_LEVELS.DEBUG)) {
        return;
    }

    const timestamp = getTimestamp();
    console.group(`%c[${timestamp}] %c[API]%c ${method.toUpperCase()} ${url}`, STYLES.timestamp, 'color: #00aa88; font-weight: bold;', STYLES.message);

    if (data) {
        console.log('Data:', data);
    }

    console.groupEnd();
};

export default {
    error,
    warn,
    info,
    debug,
    isUserRejectedError,
    api,
    LOG_LEVELS
};
