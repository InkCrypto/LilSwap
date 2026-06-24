/**
 * Unified activity types for the history sheet.
 * Maps to swap_type in the transactions table and itemType in local tracking.
 */
export type ActivityType = 'spot-swap' | 'aave-swap' | 'limit-order';

/**
 * A single activity item displayed in the history sheet.
 * Represents any user action: spot swap, Aave swap, limit order, etc.
 */
export interface ActivityItem {
    hash: string;
    chainId: number;
    description: string;
    status: 'pending' | 'success' | 'error';
    timestamp: number;
    activityType: ActivityType;
    fromTokenSymbol?: string;
    toTokenSymbol?: string;
    isApi?: boolean;
    revertReason?: string;
    /** Raw server tx_status (e.g. CONFIRMED, FAILED, OPEN, FULFILLED) */
    txStatus?: string;

    // Limit-order-specific fields
    orderUid?: string;
    limitPrice?: string;
    validTo?: number;
    fromAmount?: string;
    toAmount?: string;
}

/** Human-readable label for each activity type */
export function getActivityLabel(type: ActivityType): string {
    switch (type) {
        case 'spot-swap':
            return 'Spot Swaps';
        case 'aave-swap':
            return 'Aave Swaps';
        case 'limit-order':
            return 'Limit Orders';
    }
}

/** Badge color class per activity type */
export function getActivityColor(type: ActivityType): string {
    switch (type) {
        case 'spot-swap':
            return 'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-900/20';
        case 'aave-swap':
            return 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20';
        case 'limit-order':
            return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20';
    }
}
