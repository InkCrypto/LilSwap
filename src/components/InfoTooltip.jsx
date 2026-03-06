import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

// A tiny tooltip that renders its box in a portal so it can't be clipped by parent overflow.
// Usage: <InfoTooltip message="some text"><button>i</button></InfoTooltip> or <InfoTooltip content="some text" size={12} />
export const InfoTooltip = ({ message, content, size = 14, children }) => {
    const tooltipText = message || content;
    const [visible, setVisible] = useState(false);
    const anchorRef = useRef(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (anchorRef.current && !anchorRef.current.contains(event.target)) {
                setVisible(false);
            }
        };

        if (visible) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [visible]);

    const handleClick = (e) => {
        // Prevent event propagation so clicking the tooltip button doesn't trigger parent handlers
        e.stopPropagation();

        if (!visible) {
            if (anchorRef.current) {
                const rect = anchorRef.current.getBoundingClientRect();
                setCoords({
                    top: rect.bottom + 8,
                    left: rect.left + (rect.width / 2)
                });
            }
            setVisible(true);
        } else {
            setVisible(false);
        }
    };

    return (
        <>
            <span
                ref={anchorRef}
                onClick={handleClick}
                className="relative inline-flex cursor-pointer"
            >
                {children || <Info size={size} className="text-slate-400 hover:text-slate-500 dark:text-slate-500 dark:hover:text-slate-400 transition-colors" />}
            </span>
            {visible && createPortal(
                <div
                    className="p-2.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-800 dark:text-slate-300 shadow-xl text-center leading-relaxed backdrop-blur-md z-11000"
                    style={{
                        position: 'fixed',
                        top: coords.top,
                        left: coords.left,
                        transform: 'translateX(-50%)',
                        maxWidth: '140px', // Force two-line design for short phrases
                    }}
                >
                    {tooltipText}
                </div>,
                document.body
            )}
        </>
    );
};
