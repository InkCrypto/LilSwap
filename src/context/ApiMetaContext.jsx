import React, { createContext, useContext, useState, useCallback } from 'react';

const ApiMetaContext = createContext({ apiVersion: null });

let _setApiVersion = null;

/**
 * Called by the axios interceptor on every successful response.
 * Kept outside React so it's callable without a hook.
 */
export const notifyApiVersion = (version) => {
    if (_setApiVersion) _setApiVersion(version);
};

export const ApiMetaProvider = ({ children }) => {
    const [apiVersion, setApiVersion] = useState(null);

    // Expose the setter so the interceptor can call it
    _setApiVersion = useCallback((v) => {
        setApiVersion(prev => (prev === v ? prev : v));
    }, []);

    return (
        <ApiMetaContext.Provider value={{ apiVersion }}>
            {children}
        </ApiMetaContext.Provider>
    );
};

export const useApiMeta = () => useContext(ApiMetaContext);
