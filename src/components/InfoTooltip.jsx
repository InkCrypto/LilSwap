import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

// A tiny tooltip that renders its box in a portal so it can't be clipped by parent overflow.
// Usage: <InfoTooltip message="some text"><button>i</button></InfoTooltip>
export const InfoTooltip = ({ message, children }) => {
    const [visible, setVisible] = useState(false);
    const anchorRef = useRef(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    const handleMouseEnter = () => {
        if (anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            // Position centered below the anchor
            setCoords({
                top: rect.bottom + 8,
                left: rect.left + (rect.width / 2)
            });
        }
        setVisible(true);
    };

    const handleMouseLeave = () => {
        setVisible(false);
    };

    return (
        <>
            <span
                ref={anchorRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className="relative inline-flex"
            >
                {children}
            </span>
            {visible && createPortal(
                <div
                    className="p-2.5 rounded-md bg-slate-900 border border-slate-700 text-[11px] text-slate-300 shadow-xl text-center leading-relaxed backdrop-blur-md z-[11000]"
                    style={{
                        position: 'fixed',
                        top: coords.top,
                        left: coords.left,
                        transform: 'translateX(-50%)',
                        maxWidth: '140px', // Force two-line design for short phrases
                    }}
                >
                    {message}
                </div>,
                document.body
            )}
        </>
    );
};
