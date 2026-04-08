import { useSyncExternalStore } from 'react';

export interface UiPreferences {
    showAddress: boolean;
}

type UiPreferenceKey = keyof UiPreferences;

const STORAGE_KEYS: Record<UiPreferenceKey, string> = {
    showAddress: 'lilswap_show_address',
};

const DEFAULT_PREFERENCES: UiPreferences = {
    showAddress: false,
};

const listeners = new Set<() => void>();
let currentPreferences: UiPreferences = DEFAULT_PREFERENCES;
let initialized = false;

const subscribe = (callback: () => void) => {
    listeners.add(callback);

    return () => listeners.delete(callback);
};

const notify = () => listeners.forEach((listener) => listener());

const readStoredPreference = (key: UiPreferenceKey): boolean => {
    const storedValue = window.localStorage.getItem(STORAGE_KEYS[key]);

    if (storedValue == null) {
        return DEFAULT_PREFERENCES[key];
    }

    return storedValue === 'true';
};

const writeStoredPreference = (key: UiPreferenceKey, value: boolean) => {
    window.localStorage.setItem(STORAGE_KEYS[key], value.toString());
};

const initializePreferences = () => {
    if (initialized || typeof window === 'undefined') {
        return;
    }

    currentPreferences = {
        showAddress: readStoredPreference('showAddress'),
    };

    (Object.keys(DEFAULT_PREFERENCES) as UiPreferenceKey[]).forEach((key) => {
        if (window.localStorage.getItem(STORAGE_KEYS[key]) == null) {
            writeStoredPreference(key, currentPreferences[key]);
        }
    });

    initialized = true;
};

const getSnapshot = () => {
    initializePreferences();

    return currentPreferences;
};

export const updateUiPreference = (key: UiPreferenceKey, value: boolean) => {
    initializePreferences();

    currentPreferences = {
        ...currentPreferences,
        [key]: value,
    };

    if (typeof window !== 'undefined') {
        writeStoredPreference(key, value);
    }

    notify();
};

export const useUiPreferences = () => {
    const preferences = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_PREFERENCES);

    return {
        preferences,
        updatePreference: updateUiPreference,
        togglePreference: (key: UiPreferenceKey) => updateUiPreference(key, !preferences[key]),
    } as const;
};
