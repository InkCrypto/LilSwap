const POST_TRANSACTION_REFRESH_DELAY_MS = 8000;

let scheduledRefreshTimer: number | null = null;

const clearScheduledPositionRefreshes = () => {
    if (typeof window === 'undefined') {
        return;
    }

    if (scheduledRefreshTimer !== null) {
        window.clearTimeout(scheduledRefreshTimer);
        scheduledRefreshTimer = null;
    }
};

export const schedulePositionRefresh = (source = 'post-transaction') => {
    if (typeof window === 'undefined') {
        return;
    }

    clearScheduledPositionRefreshes();

    window.dispatchEvent(new CustomEvent('lilswap:position-refresh-scheduled', {
        detail: {
            source,
            delayMs: POST_TRANSACTION_REFRESH_DELAY_MS,
            scheduledAt: Date.now(),
        },
    }));

    scheduledRefreshTimer = window.setTimeout(() => {
        scheduledRefreshTimer = null;
        window.dispatchEvent(new CustomEvent('lilswap:refresh-positions', {
            detail: {
                source,
                delayMs: POST_TRANSACTION_REFRESH_DELAY_MS,
            },
        }));
    }, POST_TRANSACTION_REFRESH_DELAY_MS);
};
