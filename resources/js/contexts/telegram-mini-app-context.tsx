import React, { createContext, useContext } from 'react';
import { TelegramMiniAppApi, useTelegramMiniApp } from '@/hooks/use-telegram-mini-app';

const TelegramMiniAppContext = createContext<TelegramMiniAppApi | null>(null);

export function TelegramMiniAppProvider({ children }: { children: React.ReactNode }) {
    const telegram = useTelegramMiniApp();

    return (
        <TelegramMiniAppContext.Provider value={telegram}>
            {children}
        </TelegramMiniAppContext.Provider>
    );
}

export function useTelegramMiniAppContext() {
    const context = useContext(TelegramMiniAppContext);

    if (!context) {
        throw new Error('useTelegramMiniAppContext must be used within TelegramMiniAppProvider');
    }

    return context;
}
