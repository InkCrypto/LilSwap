import { useCallback, useEffect, useState } from 'react';
import { getMiniAppName, shouldEnableTelegramIntegration } from '@/lib/runtime';
import { checkTelegramWriteAccess } from '@/services/telegram-api';

export type TelegramMiniAppState = {
    enabled: boolean;
    available: boolean;
    initialized: boolean;
    active: boolean | null;
    platform: string | null;
    version: string | null;
    colorScheme: 'light' | 'dark' | null;
    startParam: string | null;
    initDataPresent: boolean;
    viewportHeight: number | null;
    viewportStableHeight: number | null;
    lastEvent: string | null;
    miniAppName: string | null;
    allowsWriteToPm: boolean;
};

export type TelegramMiniAppApi = TelegramMiniAppState & {
    initData: string | null;
    showAlert: (message: string) => void;
    showConfirm: (message: string) => Promise<boolean>;
    requestWriteAccess: () => Promise<boolean>;
    updateAllowsWriteToPm: (value: boolean) => void;
    checkWriteAccess: () => Promise<void>;
    hapticSuccess: () => void;
    hapticError: () => void;
    hapticSelection: () => void;
};

function getTelegramWebApp(): TelegramWebApp | null {
    if (typeof window === 'undefined') return null;
    return window.Telegram?.WebApp ?? null;
}

export function useTelegramMiniApp(): TelegramMiniAppApi {
    const enabled = shouldEnableTelegramIntegration();
    const webApp = enabled ? getTelegramWebApp() : null;
    const available = webApp !== null;

    const [state, setState] = useState<TelegramMiniAppState>({
        enabled,
        available,
        initialized: false,
        active: webApp?.isActive ?? null,
        platform: webApp?.platform ?? null,
        version: webApp?.version ?? null,
        colorScheme: webApp?.colorScheme ?? null,
        startParam: webApp?.initDataUnsafe?.start_param ?? null,
        initDataPresent: !!webApp?.initData,
        viewportHeight: webApp?.viewportHeight ?? null,
        viewportStableHeight: webApp?.viewportStableHeight ?? null,
        lastEvent: null,
        miniAppName: getMiniAppName(),
        allowsWriteToPm: !!webApp?.initDataUnsafe?.user?.allows_write_to_pm,
    });

    useEffect(() => {
        if (!enabled || !webApp) return;

        // Initialize Telegram WebApp
        webApp.ready();
        webApp.expand();

        setState((prev) => ({
            ...prev,
            initialized: true,
        }));

        const onActivated = () => setState((prev) => ({ ...prev, active: true, lastEvent: 'activated' }));
        const onDeactivated = () => setState((prev) => ({ ...prev, active: false, lastEvent: 'deactivated' }));
        const onThemeChanged = () => {
            if (webApp) {
                setState((prev) => ({ ...prev, colorScheme: webApp.colorScheme, lastEvent: 'themeChanged' }));
            }
        };
        const onViewportChanged = () => {
            if (webApp) {
                setState((prev) => ({
                    ...prev,
                    viewportHeight: webApp.viewportHeight ?? prev.viewportHeight,
                    viewportStableHeight: webApp.viewportStableHeight ?? prev.viewportStableHeight,
                    lastEvent: 'viewportChanged',
                }));
            }
        };

        webApp.onEvent('activated', onActivated);
        webApp.onEvent('deactivated', onDeactivated);
        webApp.onEvent('themeChanged', onThemeChanged);
        webApp.onEvent('viewportChanged', onViewportChanged);
        webApp.onEvent('fullscreenChanged', () => setState((prev) => ({ ...prev, lastEvent: 'fullscreenChanged' })));
        webApp.onEvent('fullscreenFailed', () => setState((prev) => ({ ...prev, lastEvent: 'fullscreenFailed' })));
        webApp.onEvent('backButtonClicked', () => setState((prev) => ({ ...prev, lastEvent: 'backButtonClicked' })));
        webApp.onEvent('settingsButtonClicked', () => setState((prev) => ({ ...prev, lastEvent: 'settingsButtonClicked' })));
        webApp.onEvent('popupClosed', () => setState((prev) => ({ ...prev, lastEvent: 'popupClosed' })));
        webApp.onEvent('writeAccessRequested', () => setState((prev) => ({ ...prev, lastEvent: 'writeAccessRequested' })));

        // Listen for write access changes reported by the API interceptor
        const onWriteAccessChanged = (e: CustomEvent<{ allowsWriteToPm: boolean }>) => {
            setState((prev) => ({ ...prev, allowsWriteToPm: e.detail.allowsWriteToPm }));
        };

        window.addEventListener('lilswap:telegram_write_access_changed', onWriteAccessChanged as EventListener);

        return () => {
            webApp.offEvent('activated', onActivated);
            webApp.offEvent('deactivated', onDeactivated);
            webApp.offEvent('themeChanged', onThemeChanged);
            webApp.offEvent('viewportChanged', onViewportChanged);
            window.removeEventListener('lilswap:telegram_write_access_changed', onWriteAccessChanged as EventListener);
        };
    }, [enabled, webApp]);

    const showAlert = useCallback(
        (message: string) => {
            if (webApp?.showAlert) {
                webApp.showAlert(message);
            }
        },
        [webApp],
    );

    const showConfirm = useCallback(
        (message: string): Promise<boolean> => {
            return new Promise((resolve) => {
                if (webApp?.showConfirm) {
                    webApp.showConfirm(message, (confirmed: boolean) => {
                        resolve(confirmed);
                    });
                } else {
                    resolve(false);
                }
            });
        },
        [webApp],
    );

    const requestWriteAccess = useCallback((): Promise<boolean> => {
        return new Promise((resolve) => {
            if (webApp?.requestWriteAccess) {
                webApp.requestWriteAccess((granted: boolean) => {
                    resolve(granted);
                });
            } else {
                resolve(false);
            }
        });
    }, [webApp]);

    const hapticSuccess = useCallback(() => {
        webApp?.HapticFeedback?.notificationOccurred?.('success');
    }, [webApp]);

    const hapticError = useCallback(() => {
        webApp?.HapticFeedback?.notificationOccurred?.('error');
    }, [webApp]);

    const hapticSelection = useCallback(() => {
        webApp?.HapticFeedback?.selectionChanged?.();
    }, [webApp]);

    const updateAllowsWriteToPm = useCallback((value: boolean) => {
        setState((prev) => ({ ...prev, allowsWriteToPm: value }));
    }, []);

    const checkWriteAccess = useCallback(async () => {
        try {
            const res = await checkTelegramWriteAccess();
            const allowed = res.data?.allowsWriteToPm === true;
            setState((prev) => ({ ...prev, allowsWriteToPm: allowed }));
        } catch {
            // Non-blocking
        }
    }, []);

    return {
        ...state,
        initData: webApp?.initData ?? null,
        showAlert,
        showConfirm,
        requestWriteAccess,
        updateAllowsWriteToPm,
        checkWriteAccess,
        hapticSuccess,
        hapticError,
        hapticSelection,
    };
}
