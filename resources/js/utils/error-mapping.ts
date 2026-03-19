/**
 * Error Mapping Utility
 *
 * Maps technical error codes and messages from ParaSwap, Aave, and other services
 * to user-friendly English messages.
 */

interface ErrorConfig {
    en: string;
}

const ERROR_MAP: Record<string, ErrorConfig> = {
    // Specific Selectors (checked first)
    '0x2075cc10': {
        en: 'Calculation error (Invalid Burn Amount). For small trades, try a larger amount.'
    },
    '0xad65e69e': {
        en: 'Insufficient liquidity for flash loan. Try a smaller amount or a different token.'
    },
    '0x38cfb688': {
        en: 'Insufficient flash loan balance. Try a smaller amount.'
    },
    '0x81ceff30': {
        en: 'Swap execution failed. Try increasing slippage in Settings.'
    },
    '0x850c6f76': {
        en: 'Slippage too high. Try a smaller amount or adjust settings.'
    },
    'OVERFLOW': {
        en: 'Calculation error (Overflow). Try a different amount.'
    },
    'UNDERFLOW': {
        en: 'Calculation error (Underflow). Try a different amount.'
    },

    // ParaSwap Errors
    'ESTIMATED_LOSS_GREATER_THAN_MAX_IMPACT': {
        en: 'Price impact too high. Try a smaller amount or check liquidity.'
    },
    'NO_ROUTE': {
        en: 'No swap route found. Try a different token or a smaller amount.'
    },
    'INSUFFICIENT_LIQUIDITY': {
        en: 'Insufficient liquidity. Try a smaller amount.'
    },
    'liquidity': {
        en: 'Insufficient liquidity for this swap. Try a different amount or token pair.'
    },
    'No routes found': {
        en: 'No profitable swap route found. This can happen with very small amounts or low liquidity pairs.'
    },
    'must be an integer': {
        en: 'Invalid fee configuration (must be an integer). Please reload and try again.'
    },
    'slippage': {
        en: 'Execution failed due to price change. Try increasing slippage in Settings.'
    },
    'reverted': {
        en: 'Transaction reverted on-chain. This usually happens due to low slippage or high price impact.'
    },
    'insufficient balance': {
        en: 'Insufficient balance to cover the transaction and gas fees.'
    },
    'CALL_EXCEPTION': {
        en: 'Transaction simulation failed. The trade might revert on-chain.'
    },
    'missing revert data': {
        en: 'The transaction reverted without a specific reason. Try increasing slippage.'
    },
    'UNPREDICTABLE_GAS_LIMIT': {
        en: 'Unable to estimate gas. The transaction is likely to fail.'
    }
};

/**
 * Translates a technical error message into a user-friendly one.
 * @param technicalMessage - The raw error message or code.
 * @param locale - The language to translate to ('en' or 'pt').
 * @returns The translated message.
 */
export const mapErrorToUserFriendly = (technicalMessage: string | null | undefined, locale: 'en' | 'pt' = 'en'): string | null => {
    if (!technicalMessage) return null;

    // Check for direct matches in ERROR_MAP
    for (const [key, pair] of Object.entries(ERROR_MAP)) {
        if (technicalMessage.includes(key)) {
            return pair[locale as keyof ErrorConfig] || pair.en;
        }
    }

    // Fallback logic for common phrases
    const lowerMessage = technicalMessage.toLowerCase();
    
    if (lowerMessage.includes('user rejected')) {
        return 'Transaction cancelled by user.';
    }

    if (lowerMessage.includes('insufficient funds')) {
        return 'Insufficient funds for gas.';
    }

    // If message is too long and no mapping found, return a generic one
    if (technicalMessage.length > 200) {
        return 'An unexpected technical error occurred. Please check your connection or try again.';
    }

    return technicalMessage; // Fallback to original if no mapping found
};
