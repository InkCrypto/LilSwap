export const requireRecommendedSlippageBps = (quote: any): number => {
    const rawValue = quote?.recommendedSlippageBps;
    const value = typeof rawValue === 'number'
        ? rawValue
        : (typeof rawValue === 'string' && rawValue.trim() !== '' ? Number(rawValue) : NaN);

    if (!Number.isFinite(value) || value < 0 || value > 5000) {
        throw new Error('Quote response is missing a valid recommendedSlippageBps value');
    }

    return Math.floor(value);
};
