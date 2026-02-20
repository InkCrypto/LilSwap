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
            setCoords({ top: rect.top, left: rect.right + 4 });
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
                    className="p-3 rounded-md bg-slate-900 border border-slate-700 text-xs text-slate-400 shadow-lg"
                    style={{
                        position: 'fixed',
                        top: coords.top,
                        left: coords.left,
                        zIndex: 11000,
                        maxWidth: '280px',
                    }}
                >
                    {message}
                </div>,
                document.body
            )}
        </>
    );
};
