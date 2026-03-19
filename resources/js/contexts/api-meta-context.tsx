import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ApiMetaContextType {
    apiVersion: string | null;
    isApiUp: boolean;
}

const ApiMetaContext = createContext<ApiMetaContextType>({ apiVersion: null, isApiUp: true });

let _setApiVersion: ((v: string | null) => void) | null = null;
let _setIsApiUp: ((status: boolean) => void) | null = null;

/**
 * Called by the axios interceptor on every successful response.
 * Kept outside React so it's callable without a hook.
 */
export const notifyApiVersion = (version: string) => {
    if (_setApiVersion) _setApiVersion(version);
};

export const notifyApiStatus = (isUp: boolean) => {
    if (_setIsApiUp) _setIsApiUp(isUp);
};

export const ApiMetaProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [apiVersion, setApiVersion] = useState<string | null>(null);
    const [isApiUp, setIsApiUp] = useState(true);

    // Expose the setter so the interceptor can call it
    _setApiVersion = useCallback((v: string | null) => {
        setApiVersion(prev => (prev === v ? prev : v));
    }, []);

    _setIsApiUp = useCallback((status: boolean) => {
        setIsApiUp(prev => (prev === status ? prev : status));
    }, []);

    return (
        <ApiMetaContext.Provider value={{ apiVersion, isApiUp }}>
            {children}
        </ApiMetaContext.Provider>
    );
};

export const useApiMeta = () => useContext(ApiMetaContext);
