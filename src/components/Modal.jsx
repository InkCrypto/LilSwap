import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Modal Component
 * Generic modal with backdrop, centering, and close handlers
 */
export const Modal = ({ isOpen, onClose, title, children, maxWidth = '500px' }) => {
    const modalRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return;

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    useEffect(() => {
        if (isOpen) {
            // Prevent body scroll when modal is open
            document.body.style.overflow = 'hidden';
            // Focus modal for accessibility
            modalRef.current?.focus();
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />

            {/* Modal Container */}
            <div
                ref={modalRef}
                tabIndex={-1}
                className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl animate-in zoom-in-95 fade-in duration-200 overflow-hidden"
                style={{ maxWidth, width: '100%', maxHeight: '90vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                {title && (
                    <div className="flex items-center justify-between p-4 border-b border-slate-700">
                        <h2 className="text-lg font-bold text-white">{title}</h2>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
                            aria-label="Close modal"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                )}

                {/* Content */}
                <div className="overflow-y-auto max-h-[calc(90vh-80px)] custom-scrollbar">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
};
