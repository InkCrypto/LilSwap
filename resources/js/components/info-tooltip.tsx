import { Info } from 'lucide-react';
import React, { useState, useEffect, useId } from 'react';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "./ui/tooltip";

interface InfoTooltipProps {
    message?: string;
    content?: string;
    size?: number;
    maxWidth?: string;
    children?: React.ReactNode;
    disableClick?: boolean;
    disableHover?: boolean;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
    message,
    content,
    size = 14,
    maxWidth = '250px',
    children,
    disableClick = false,
    disableHover = false
}) => {
    const id = useId();
    const [open, setOpen] = useState(false);
    const [isClicked, setIsClicked] = useState(false);
    const tooltipText = message || content;

    useEffect(() => {
        const handleOtherOpen = (e: any) => {
            if (e.detail.id !== id) {
                setIsClicked(false);
                setOpen(false);
            }
        };
        window.addEventListener('info-tooltip-open', handleOtherOpen);

        return () => window.removeEventListener('info-tooltip-open', handleOtherOpen);
    }, [id]);

    const handleClick = (e: React.MouseEvent) => {
        if (disableClick) {
            return;
        }

        e.stopPropagation();
        const nextState = !isClicked;
        
        if (nextState) {
            // Notify other tooltips to close
            window.dispatchEvent(new CustomEvent('info-tooltip-open', { detail: { id } }));
        }

        setIsClicked(nextState);
        setOpen(nextState);
    };

    const handleOpenChange = (newOpen: boolean) => {
        if (newOpen) {
            if (disableHover && !isClicked) {
                return;
            }

            // Notify other tooltips to close when this one starts to open (even via hover)
            window.dispatchEvent(new CustomEvent('info-tooltip-open', { detail: { id } }));
        }

        // If it was opened by click, we preserve it regardless of hover state
        // Note: if another tooltip calls handleOpenChange(true), our useEffect 
        // will set isClicked to false, allowing this one to close.
        if (isClicked) {
            return;
        }

        setOpen(newOpen);
    };

    return (
        <Tooltip open={open || isClicked} onOpenChange={handleOpenChange} delayDuration={700}>
            <TooltipTrigger asChild onClick={handleClick} onFocus={(e) => e.target.blur()}>
                <span 
                    className="relative inline-flex cursor-pointer transition-opacity hover:opacity-80 outline-none"
                    onFocus={(e) => (e.target as HTMLElement).blur()}
                >
                    {children || <Info size={size} className="text-slate-400 hover:text-slate-500 dark:text-slate-500 dark:hover:text-slate-400 transition-colors" />}
                </span>
            </TooltipTrigger>
            <TooltipContent
                showArrow={false}
                className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl pointer-events-none select-none"
                style={{ maxWidth }}
                onPointerDownOutside={() => {
                    setIsClicked(false);
                    setOpen(false);
                }}
            >
                <p className="text-[12px] text-slate-800 dark:text-slate-300 text-center leading-relaxed">
                    {tooltipText}
                </p>
            </TooltipContent>
        </Tooltip>
    );
};
