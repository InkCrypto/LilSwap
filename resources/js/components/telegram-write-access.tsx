import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useTelegramMiniAppContext } from '@/contexts/telegram-mini-app-context';
import { apiClient } from '@/services/api';
import { Modal } from '@/components/modal';
import { Bell, Send } from 'lucide-react';

const STORAGE_KEY = 'lilswap:telegram_write_access_granted';
const DISMISS_KEY = 'lilswap:telegram_welcome_dismissed';

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

function isWelcomeDismissed(): boolean {
    try {
        return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
        return false;
    }
}

function setWelcomeDismissed() {
    try {
        localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
        // Storage not available
    }
}

// Telegram custom SVG icon for a premium, official look (inner paper plane only)
const TelegramIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
        <path d="M19.9 4.7a.75.75 0 0 0-.7-.1l-15 5.5a.75.75 0 0 0-.1 1.4l4.2 1.6 8.4-6.3c.1-.1.2.1.1.2l-6.9 6.3-.2 2.5a.75.75 0 0 0 1.3.5l2.6-2.5 4.1 3a.75.75 0 0 0 1.2-.5l3-11a.75.75 0 0 0-.5-.7z" />
    </svg>
);

export function TelegramWriteAccessRequest() {
    const tg = useTelegramMiniAppContext();
    const [requesting, setRequesting] = useState(false);

    // Derive granted directly from the context and storage to be fully reactive
    const granted = tg.allowsWriteToPm || isGrantedInStorage();

    // Welcome modal state
    const [modalOpen, setModalOpen] = useState(false);

    // Call checkWriteAccess on mount to check the current status in real-time
    useEffect(() => {
        if (tg.enabled && tg.available) {
            tg.checkWriteAccess().catch(() => { });
        }
    }, [tg.enabled, tg.available, tg.checkWriteAccess]);

    // Initialize modal state on mount or when granted state changes
    useEffect(() => {
        if (tg.enabled && tg.available && !granted && !isWelcomeDismissed()) {
            // Short delay to allow screen transition to complete smoothly
            const timer = setTimeout(() => {
                setModalOpen(true);
            }, 1200);
            return () => clearTimeout(timer);
        }
    }, [tg.enabled, tg.available, granted]);

    const handleRequest = useCallback(async () => {
        if (requesting || granted) return;
        setRequesting(true);

        try {
            const result = await tg.requestWriteAccess();

            if (result) {
                setGrantedInStorage();
                tg.updateAllowsWriteToPm(true);
                setModalOpen(false);

                await apiClient.post('/telegram/update-write-access', {
                    allowsWriteToPm: true,
                }).catch(() => { });
            }
        } finally {
            setRequesting(false);
        }
    }, [tg, requesting, granted]);

    const handleDismiss = useCallback(() => {
        setWelcomeDismissed();
        setModalOpen(false);
    }, []);

    const handleOpenModal = useCallback(() => {
        setModalOpen(true);
    }, []);

    // Ensure this only displays inside the Telegram Mini App environment
    if (!tg.enabled || !tg.available) return null;
    if (granted) return null;

    return (
        <>
            {/* Elegant Welcome & Notification Request Modal */}
            <Modal
                isOpen={modalOpen}
                onClose={handleDismiss}
                maxWidth="380px"
                headerBorder={false}
                showCloseButton={false}
            >
                <div className="flex flex-col items-center text-center p-6 bg-slate-50 dark:bg-slate-900">
                    {/* Visual representation containing Telegram logo & Bell */}
                    <div className="relative mb-5 flex items-center justify-center">
                        <div className="w-16 h-16 bg-[#229ED9] rounded-full flex items-center justify-center text-white shadow-md">
                            <TelegramIcon className="w-9 h-9 -translate-x-0.5 translate-y-0.5" />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-amber-500 text-white rounded-full flex items-center justify-center border-2 border-slate-50 dark:border-slate-900 animate-bounce">
                            <Bell className="w-4 h-4" />
                        </div>
                    </div>

                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-white mb-2 tracking-tight">
                        Enable Notifications
                    </h3>

                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
                        Allow <strong>LilSwapBot</strong> to send you instant alerts directly on Telegram when your swaps are confirmed or when your positions need attention.
                    </p>

                    <div className="w-full space-y-2">
                        <button
                            onClick={handleRequest}
                            disabled={requesting}
                            className="relative overflow-hidden w-full px-4 py-2.5 bg-primary dark:bg-primary/90 text-white font-bold rounded-xl text-sm hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(168,85,247,0.25)] dark:shadow-[0_4px_12px_rgba(168,85,247,0.15)]"
                        >
                            {requesting ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>
                                    <Send className="w-4 h-4" />
                                    <span>Allow Notifications</span>
                                </>
                            )}
                        </button>

                        <button
                            onClick={handleDismiss}
                            disabled={requesting}
                            className="w-full px-4 py-2 text-slate-500 dark:text-slate-400 font-medium rounded-xl text-xs hover:text-slate-800 dark:hover:text-slate-200 transition-colors active:scale-95"
                        >
                            Maybe Later
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Premium floating action button to reopen the settings if dismissed */}
            {!modalOpen && (
                <button
                    onClick={handleOpenModal}
                    title="Enable Telegram Notifications"
                    className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-50 w-12 h-12 bg-[#229ED9] hover:bg-[#208fC5] text-white rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all flex items-center justify-center"
                    aria-label="Telegram notification settings"
                >
                    <div className="relative">
                        <TelegramIcon className="w-6 h-6 -translate-x-0.5 translate-y-0.5" />
                        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                        </span>
                    </div>
                </button>
            )}
        </>
    );
}

