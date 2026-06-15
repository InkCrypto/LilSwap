const LOW_HEALTH_FACTOR_THRESHOLD = 1.05;
const MATERIAL_HEALTH_FACTOR_DECREASE = 0.005;

export function requiresLowHealthFactorConfirmation(
    currentHealthFactor: number,
    healthFactorAfterSwap: number,
): boolean {
    if (
        !Number.isFinite(currentHealthFactor) ||
        !Number.isFinite(healthFactorAfterSwap)
    ) {
        return false;
    }

    return (
        healthFactorAfterSwap >= 1 &&
        healthFactorAfterSwap < LOW_HEALTH_FACTOR_THRESHOLD &&
        currentHealthFactor - healthFactorAfterSwap >=
            MATERIAL_HEALTH_FACTOR_DECREASE
    );
}
