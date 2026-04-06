const INFRASTRUCTURE_ERROR_PATTERNS = [
    /curl error/i,
    /failed to connect/i,
    /couldn't connect to server/i,
    /econnrefused/i,
    /network error/i,
    /socket hang up/i,
    /dns/i,
    /getaddrinfo/i,
    /localhost(?::\d+)?/i,
    /https?:\/\//i,
];

const sanitizeMessage = (message: string) => {
    return message
        .replace(/\bhttps?:\/\/[^\s)]+/gi, 'the service')
        .replace(/\blocalhost(?::\d+)?(?:\/[^\s)]*)?/gi, 'the service')
        .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s)]*)?/gi, 'the service')
        .replace(/\s+/g, ' ')
        .trim();
};

const isInfrastructureError = (message: string) => {
    return INFRASTRUCTURE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const getPublicApiErrorMessage = (error: any, fallback = 'Something went wrong') => {
    const data = error?.response?.data;
    const userMessage = typeof data?.userMessage === 'string' ? data.userMessage.trim() : '';
    const rawMessage =
        (typeof data?.message === 'string' && data.message.trim()) ||
        (typeof data?.error === 'string' && data.error.trim()) ||
        (typeof error?.message === 'string' && error.message.trim()) ||
        '';

    if (userMessage) {
        return userMessage;
    }

    if (error?.response?.status === 429 || /rate limit/i.test(rawMessage)) {
        return 'Service busy right now. Please try again in a few seconds.';
    }

    if (/call_exception/i.test(rawMessage)) {
        return 'Error querying Aave. Please try again in a few seconds.';
    }

    if (error?.code === 'ECONNABORTED' || /timed out|timeout/i.test(rawMessage)) {
        return 'The request took too long. Please try again.';
    }

    if (!error?.response || isInfrastructureError(rawMessage)) {
        return 'Unable to reach the service right now. Please try again.';
    }

    const sanitizedMessage = sanitizeMessage(rawMessage);

    return sanitizedMessage || fallback;
};
