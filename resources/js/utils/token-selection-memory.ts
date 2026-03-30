const STORAGE_KEY = 'lilswap-token-selection-memory';
const SELECTION_TTL = 30 * 60 * 1000; // 30 minutes

interface SelectionEntry {
    address: string;
    timestamp: number;
}

interface SelectionMemory {
    [marketKey: string]: {
        [modalType: string]: SelectionEntry;
    }
}

export const saveTokenSelection = (marketKey: string, modalType: string, address: string) => {
    if (!marketKey || !modalType || !address) return;

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const data: SelectionMemory = raw ? JSON.parse(raw) : {};
        
        if (!data[marketKey]) {
            data[marketKey] = {};
        }
        
        data[marketKey][modalType] = {
            address: address.toLowerCase(),
            timestamp: Date.now()
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[SelectionMemory] Failed to save selection', e);
    }
};

export const getSavedTokenSelection = (marketKey: string, modalType: string): string | null => {
    if (!marketKey || !modalType) return null;

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        
        const data: SelectionMemory = JSON.parse(raw);
        const entry = data[marketKey]?.[modalType];
        
        if (!entry) return null;

        // Check for expiration
        if (Date.now() - entry.timestamp > SELECTION_TTL) {
            return null;
        }

        return entry.address;
    } catch (e) {
        console.warn('[SelectionMemory] Failed to get selection', e);
        return null;
    }
};
