import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';

interface UserActivityContextType {
    isTabVisible: boolean;
    isUserActive: boolean;
    lastActivity: number;
}

const UserActivityContext = createContext<UserActivityContextType>({
    isTabVisible: true,
    isUserActive: true,
    lastActivity: Date.now()
});

export const UserActivityProvider: React.FC<{ children: ReactNode; inactivityThreshold?: number }> = ({ 
    children, 
    inactivityThreshold = 1800000 
}) => {
    const [isTabVisible, setIsTabVisible] = useState(true);
    const [isUserActive, setIsUserActive] = useState(true);
    const [lastActivity, setLastActivity] = useState(Date.now());
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleActivity = () => {
        setLastActivity(Date.now());
        setIsUserActive(true);

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
            setIsUserActive(false);
        }, inactivityThreshold);
    };

    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsTabVisible(document.visibilityState === 'visible');
            if (document.visibilityState === 'visible') {
                handleActivity();
            }
        };

        const activityEvents = [
            'mousedown', 'mousemove', 'keydown',
            'scroll', 'touchstart', 'click'
        ];

        document.addEventListener('visibilitychange', handleVisibilityChange);

        activityEvents.forEach(event => {
            window.addEventListener(event, handleActivity, { passive: true });
        });

        timeoutRef.current = setTimeout(() => {
            setIsUserActive(false);
        }, inactivityThreshold);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            activityEvents.forEach(event => {
                window.removeEventListener(event, handleActivity as any);
            });
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [inactivityThreshold]);

    return (
        <UserActivityContext.Provider value={{ isTabVisible, isUserActive, lastActivity }}>
            {children}
        </UserActivityContext.Provider>
    );
};

export const useUserActivity = () => useContext(UserActivityContext);
