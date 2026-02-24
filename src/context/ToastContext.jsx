import React, { createContext, useContext, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, AlertTriangle, Info, ExternalLink } from 'lucide-react';

const ToastContext = createContext();

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback(({ title, message, type = 'info', action = null, duration = 5000 }) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, title, message, type, action, duration }]);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ addToast, removeToast }}>
            {children}
            {typeof document !== 'undefined' && createPortal(
                <div className="fixed bottom-4 right-4 z-[99999] flex flex-col gap-2 pointer-events-none">
                    {toasts.map(toast => (
                        <Toast key={toast.id} toast={toast} onRemove={removeToast} />
                    ))}
                </div>,
                document.body
            )}
        </ToastContext.Provider>
    );
};

const Toast = ({ toast, onRemove }) => {
    const [isHovered, setIsHovered] = useState(false);

    React.useEffect(() => {
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
        success: 'bg-emerald-950/40 border-emerald-500/30',
        error: 'bg-red-950/40 border-red-500/30',
        info: 'bg-slate-800/90 border-slate-700/80 shadow-slate-900/50'
    };

    return (
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-xl backdrop-blur-md animate-in slide-in-from-bottom-5 fade-in duration-300 w-80 ${bgColors[toast.type] || bgColors.info}`}
        >
            <div className="shrink-0 mt-0.5">
                {icons[toast.type] || icons.info}
            </div>
            <div className="flex-1 min-w-0">
                {toast.title && <div className="font-bold text-white text-sm">{toast.title}</div>}
                {toast.message && <div className="text-sm text-slate-300 mt-0.5 break-words">{toast.message}</div>}
                {toast.action && (
                    <a
                        href={toast.action.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 mt-2 text-xs font-bold text-purple-400 hover:text-purple-300 transition-colors"
                    >
                        {toast.action.label}
                        <ExternalLink className="w-3 h-3" />
                    </a>
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
