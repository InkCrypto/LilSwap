import React, { useEffect, useRef } from 'react';
import { TelegramMiniAppApi, useTelegramMiniApp } from '@/hooks/use-telegram-mini-app';
import { bootstrapTelegramMiniApp } from '@/services/telegram-api';

const TelegramMiniAppContext = React.createContext<TelegramMiniAppApi | null>(null);

export function TelegramMiniAppProvider({ children }: { children: React.ReactNode }) {
    const telegram = useTelegramMiniApp();
    const bootstrappedRef = useRef(false);

    // Bootstrap on init
    useEffect(() => {
        if (!telegram.enabled) return;
        if (!telegram.initialized) return;
        if (!telegram.initData) return;
        if (bootstrappedRef.current) return;

        bootstrappedRef.current = true;

        bootstrapTelegramMiniApp({
            initData: telegram.initData,
            platform: telegram.platform,
            version: telegram.version,
            startParam: telegram.startParam,
        }).catch(() => { });
    }, [telegram.enabled, telegram.initialized, telegram.initData, telegram.platform, telegram.version, telegram.startParam]);

    return (
        <TelegramMiniAppContext.Provider value={telegram}>
            {children}
        </TelegramMiniAppContext.Provider>
    );
}

export function useTelegramMiniAppContext() {
    const context = React.useContext(TelegramMiniAppContext);

    if (!context) {
        throw new Error('useTelegramMiniAppContext must be used within TelegramMiniAppProvider');
    }

    return context;
}
