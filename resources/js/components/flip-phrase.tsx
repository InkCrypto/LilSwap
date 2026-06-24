import React, { useEffect, useState } from 'react';

interface FlipPhraseProps {
    current: string;
    prev?: string | null;
}

const spanBase: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
};

export function FlipPhrase({ current, prev }: FlipPhraseProps) {
    return (
        <span
            style={{
                position: 'relative',
                display: 'inline-block',
                clipPath: 'inset(0 -6px)',
                verticalAlign: 'bottom',
                padding: '0 4px',
            }}
        >
            <span aria-hidden style={{ visibility: 'hidden' }}>
                <span className="text-primary italic">Little</span> fees & <span className="text-primary italic">Little</span> effort!
            </span>
            {prev !== null && prev !== undefined && (
                <span key={`out-${current}-${prev}`} style={{ ...spanBase, animation: 'word-exit 340ms ease forwards' }}>
                    <span className="text-primary italic">{prev}</span> fees & <span className="text-primary italic">{prev}</span> effort!
                </span>
            )}
            <span
                key={`in-${current}`}
                style={{
                    ...spanBase,
                    animation: prev !== null && prev !== undefined ? 'word-enter 340ms ease forwards' : 'none',
                }}
            >
                <span className="text-primary italic">{current}</span> fees & <span className="text-primary italic">{current}</span> effort!
            </span>
        </span>
    );
}

export function useFlipPhrase() {
    const [flipState, setFlipState] = useState<{ current: string; prev: string | null; key: number }>({
        current: 'Little', prev: null, key: 0,
    });

    useEffect(() => {
        const interval = setInterval(() => {
            setFlipState((currentState) => ({
                prev: currentState.current,
                current: currentState.current === 'Little' ? "Lil'" : 'Little',
                key: currentState.key + 1,
            }));

            setTimeout(() => {
                setFlipState((currentState) => ({ ...currentState, prev: null }));
            }, 380);
        }, 3500);

        return () => clearInterval(interval);
    }, []);

    const flipPhrase = (
        <FlipPhrase current={flipState.current} prev={flipState.prev} />
    );

    return flipPhrase;
}
