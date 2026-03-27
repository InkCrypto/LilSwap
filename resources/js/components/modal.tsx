import { X } from "lucide-react";
import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    children: React.ReactNode;
    maxWidth?: string;
    headerBorder?: boolean;
}

export const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    title,
    children,
    maxWidth = '460px',
    headerBorder = true
}) => {
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                className="sm:max-w-[calc(100vw-2rem)] p-0 gap-0 overflow-hidden bg-white dark:bg-slate-900 border border-border-light dark:border-slate-700 rounded-2xl shadow-2xl animate-in zoom-in-95 fade-in duration-200 outline-none"
                style={{ maxWidth }}
                aria-describedby={undefined}
                onPointerDownOutside={(e) => {
                    if (e.target instanceof Element && (e.target.closest('.lilswap-toast') || e.target.closest('.lilswap-toast-container'))) {
                        e.preventDefault();
                    }
                }}
                onInteractOutside={(e) => {
                    if (e.target instanceof Element && (e.target.closest('.lilswap-toast') || e.target.closest('.lilswap-toast-container'))) {
                        e.preventDefault();
                    }
                }}
                onOpenAutoFocus={(e) => {
                    // Focus the DialogContent instead of the first input
                    // This prevents keyboard from popping up on mobile
                }}
            >
                <DialogDescription className="sr-only">
                    {typeof title === 'string' ? `${title} dialog` : 'Modal dialog'}
                </DialogDescription>
                {title && (
                    <DialogHeader className={`p-4 flex flex-row items-center justify-between text-left ${headerBorder ? 'border-b border-border-light dark:border-slate-700' : ''}`}>
                        <DialogTitle className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            {title}
                        </DialogTitle>
                    </DialogHeader>
                )}
                {!title && (
                    <div className="absolute right-4 top-4 z-50">
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-slate-700 dark:hover:text-white"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                )}
                <div className="overflow-y-auto max-h-[85vh] custom-scrollbar">
                    {children}
                </div>
            </DialogContent>
        </Dialog>
    );
};
