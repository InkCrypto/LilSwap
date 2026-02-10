import { useEffect, useState } from 'react';

/**
 * useDebounce Hook
 * Debounces a value to avoid excessive updates
 * @param {any} value - Value to debounce
 * @param {number} delay - Delay in milliseconds (default: 500ms)
 * @returns {any} Debounced value
 */
export const useDebounce = (value, delay = 500) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        // Set timeout to update debounced value after delay
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        // Cleanup function to cancel timeout if value changes before delay
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
};
