import React, { useCallback, useRef, useState } from 'react';
import { useTelegramMiniAppContext } from '@/contexts/telegram-mini-app-context';
import { apiClient } from '@/services/api';

const STORAGE_KEY = 'lilswap:telegram_write_access_granted';

function isGrantedInStorage(): boolean {
    try {
        return sessionStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

function setGrantedInStorage() {
    try {
        sessionStorage.setItem(STORAGE_KEY, 'true');
    } catch {
        // Storage not available
    }
}

export function TelegramWriteAccessRequest() {
    const tg = useTelegramMiniAppContext();
    const [requesting, setRequesting] = useState(false);
    // Check multiple sources: initData (tg), sessionStorage (this session), and a ref
    const grantedRef = useRef(tg.allowsWriteToPm || isGrantedInStorage());
    const [granted, setGranted] = useState(grantedRef.current);

    const handleRequest = useCallback(async () => {
        if (requesting || grantedRef.current) return;
        setRequesting(true);

        try {
            const result = await tg.requestWriteAccess();

            if (result) {
                grantedRef.current = true;
                setGrantedInStorage();
                setGranted(true);
                tg.updateAllowsWriteToPm(true);

                await apiClient.post('/telegram/update-write-access', {
                    allowsWriteToPm: true,
                }).catch(() => { });
            }
        } finally {
            setRequesting(false);
        }
    }, [tg, requesting]);

    if (!tg.enabled || !tg.available) return null;
    if (granted) return null;

    return (
        <div className="fixed bottom-20 right-4 z-50 max-w-xs">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-xl text-xs">
                <p className="font-semibold text-slate-800 dark:text-slate-100 mb-1">
                    🔔 Receive swap notifications
                </p>
                <p className="text-slate-500 dark:text-slate-400 mb-2">
                    Allow LilSwapBot to send you a message when your swap is confirmed.
                </p>
                <button
                    onClick={handleRequest}
                    disabled={requesting}
                    className="w-full px-3 py-1.5 bg-primary text-white font-bold rounded-lg text-xs hover:opacity-90 disabled:opacity-50 transition-all active:scale-95"
                >
                    {requesting ? 'Requesting...' : 'Allow notifications'}
                </button>
            </div>
        </div>
    );
}
