import { X, CheckCircle2, AlertTriangle, Info, ExternalLink } from 'lucide-react';
import type { ReactNode} from 'react';
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Toast {
    id: number;
    title?: string;
    message?: string;
    type: 'success' | 'error' | 'info';
    action?: { url?: string; label: string; onClick?: () => void } | null;
    duration?: number;
    isLeaving?: boolean;
}

interface ToastContextType {
    addToast: (toast: Omit<Toast, 'id' | 'isLeaving'>) => void;
    removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
    const context = useContext(ToastContext);

    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }

    return context;
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback(({ title, message, type = 'info', action = null, duration = 5000 }: Omit<Toast, 'id' | 'isLeaving'>) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, title, message, type, action, duration }]);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, isLeaving: true } : t));
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 300);
    }, []);

    return (
        <ToastContext.Provider value={{ addToast, removeToast }}>
            {children}
            {typeof document !== 'undefined' && createPortal(
                <div className="lilswap-toast-container fixed bottom-6 right-6 z-9999 flex flex-col-reverse gap-2 pointer-events-none">
                    {toasts.map(toast => (
                        <ToastComponent key={toast.id} toast={toast} onRemove={removeToast} />
                    ))}
                </div>,
                document.body
            )}
        </ToastContext.Provider>
    );
};

const ToastComponent: React.FC<{ toast: Toast; onRemove: (id: number) => void }> = ({ toast, onRemove }) => {
    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        if (toast.duration && toast.duration > 0 && !isHovered) {
            const timer = setTimeout(() => {
                onRemove(toast.id);
            }, toast.duration);

            return () => clearTimeout(timer);
        }
    }, [toast.duration, isHovered, onRemove, toast.id]);

    const icons = {
        success: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
        error: <AlertTriangle className="w-5 h-5 text-red-400" />,
        info: <Info className="w-5 h-5 text-blue-400" />
    };

    const bgColors = {
        success: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-500/30',
        error: 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-500/30',
        info: 'bg-white border-slate-200 dark:bg-slate-800/90 dark:border-slate-700/80'
    };

    return (
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className={`lilswap-toast pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-xl backdrop-blur-md transition-all duration-300 w-80
                ${toast.isLeaving ? 'opacity-0 translate-x-8' : 'animate-in slide-in-from-right-8 fade-in'}
                ${bgColors[toast.type] || bgColors.info}
            `}
        >
            <div className="shrink-0 mt-0.5">
                {icons[toast.type] || icons.info}
            </div>
            <div className="flex-1 min-w-0">
                {toast.title && <div className="font-bold text-slate-900 dark:text-white text-sm">{toast.title}</div>}
                {toast.message && <div className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 wrap-break-word">{toast.message}</div>}
                {toast.action && (
                    <>
                        {toast.action.url ? (
                            <a
                                href={toast.action.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 mt-2 text-xs font-bold text-primary hover:text-primary/80 transition-colors"
                            >
                                {toast.action.label}
                                <ExternalLink className="w-3 h-3" />
                            </a>
                        ) : (
                            <button
                                onClick={() => {
                                    if (toast.action?.onClick) {
                                        toast.action.onClick();
                                    }
                                    onRemove(toast.id); // Also clear the toast when action is clicked
                                }}
                                className="inline-flex items-center gap-1 mt-2 text-xs font-bold text-primary hover:text-primary/80 transition-colors cursor-pointer p-0 border-none bg-transparent"
                            >
                                {toast.action.label}
                            </button>
                        )}
                    </>
                )}
            </div>
            <button
                onClick={() => onRemove(toast.id)}
                className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors p-1"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
};
