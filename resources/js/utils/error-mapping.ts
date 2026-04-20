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
    '0xcea9e31d': {
        en: 'Slippage too high or transaction failed simulation. Please try increasing slippage or check your balance.'
    },
    '0xCEA9E31D': {
        en: 'Slippage too high or transaction failed simulation. Please try increasing slippage or check your balance.'
    },
    '0x1f00bfd0': {
        en: 'Price impact too high. Try a smaller amount.'
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
    if (!technicalMessage) {
        return null;
    }

    const technicalMessageLower = String(technicalMessage).toLowerCase().trim();
    
    // Explicit hardcoded match for the slippage error code
    if (technicalMessageLower.includes('0xcea9e31d')) {
        return 'Slippage too high or transaction failed simulation. Please try increasing slippage or check your balance.';
    }

    // Check for direct matches in ERROR_MAP
    for (const [key, pair] of Object.entries(ERROR_MAP)) {
        if (technicalMessageLower.includes(key.toLowerCase())) {
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

    // Default Fallback logic
    // If the message is very long and doesn't match anything known, it's likely a cryptic 
    // technical revert/bytecode. We return a generic message while the background 
    // logger (logger.ts) handles the full detail sync to the backend.
    if (technicalMessage.length > 140) {
        return "The transaction failed. Technical details have been logged for inspection.";
    }

    // If no mapping found and message is short, return original message
    return technicalMessage;
};
