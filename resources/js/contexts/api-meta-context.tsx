import type { ReactNode } from 'react';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface ApiMetaContextType {
    apiVersion: string | null;
    isApiUp: boolean;
}

const ApiMetaContext = createContext<ApiMetaContextType>({ apiVersion: null, isApiUp: true });

const API_VERSION_EVENT = 'lilswap:api-version';
const API_STATUS_EVENT = 'lilswap:api-status';

/**
 * Called by the axios interceptor on every successful response.
 * Kept outside React so it's callable without a hook.
 */
export const notifyApiVersion = (version: string) => {
    window.dispatchEvent(new CustomEvent(API_VERSION_EVENT, { detail: version }));
};

export const notifyApiStatus = (isUp: boolean) => {
    window.dispatchEvent(new CustomEvent(API_STATUS_EVENT, { detail: isUp }));
};

export const ApiMetaProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [apiVersion, setApiVersion] = useState<string | null>(null);
    const [isApiUp, setIsApiUp] = useState(true);

    useEffect(() => {
        const onVersion = (event: Event) => {
            const customEvent = event as CustomEvent<string | null>;
            setApiVersion((prev) => (prev === customEvent.detail ? prev : customEvent.detail));
        };

        const onStatus = (event: Event) => {
            const customEvent = event as CustomEvent<boolean>;
            setIsApiUp((prev) => (prev === customEvent.detail ? prev : customEvent.detail));
        };

        window.addEventListener(API_VERSION_EVENT, onVersion as EventListener);
        window.addEventListener(API_STATUS_EVENT, onStatus as EventListener);

        return () => {
            window.removeEventListener(API_VERSION_EVENT, onVersion as EventListener);
            window.removeEventListener(API_STATUS_EVENT, onStatus as EventListener);
        };
    }, []);

    return (
        <ApiMetaContext.Provider value={{ apiVersion, isApiUp }}>
            {children}
        </ApiMetaContext.Provider>
    );
};

export const useApiMeta = () => useContext(ApiMetaContext);
