export { };

declare global {
    interface Window {
        Telegram?: {
            WebApp?: TelegramWebApp;
        };
    }

    interface TelegramWebApp {
        initData: string;
        initDataUnsafe?: {
            query_id?: string;
            user?: {
                id?: number;
                is_bot?: boolean;
                first_name?: string;
                last_name?: string;
                username?: string;
                language_code?: string;
                is_premium?: boolean;
                allows_write_to_pm?: boolean;
            };
            auth_date?: number;
            start_param?: string;
            chat_type?: string;
            chat_instance?: string;
        };

        version: string;
        platform: string;
        colorScheme: 'light' | 'dark';
        themeParams?: Record<string, string>;
        isExpanded?: boolean;
        isActive?: boolean;
        isFullscreen?: boolean;
        viewportHeight?: number;
        viewportStableHeight?: number;

        ready: () => void;
        expand: () => void;
        close: () => void;

        showAlert?: (message: string, callback?: () => void) => void;
        showConfirm?: (message: string, callback?: (confirmed: boolean) => void) => void;
        requestWriteAccess?: (callback?: (granted: boolean) => void) => void;

        openTelegramLink?: (url: string) => void;
        openLink?: (url: string, options?: unknown) => void;

        onEvent: (eventType: string, eventHandler: (...args: any[]) => void) => void;
        offEvent: (eventType: string, eventHandler: (...args: any[]) => void) => void;

        BackButton?: {
            show: () => void;
            hide: () => void;
            onClick: (callback: () => void) => void;
            offClick: (callback: () => void) => void;
        };

        SettingsButton?: {
            show: () => void;
            hide: () => void;
            onClick: (callback: () => void) => void;
            offClick: (callback: () => void) => void;
        };

        HapticFeedback?: {
            impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
            notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
            selectionChanged?: () => void;
        };
    }
}
