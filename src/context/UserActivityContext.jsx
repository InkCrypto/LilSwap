import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const UserActivityContext = createContext({
    isTabVisible: true,
    isUserActive: true,
    lastActivity: Date.now()
});

/**
 * inactivityThreshold: Time in ms before a user is considered inactive (default 5 mins)
 */
export const UserActivityProvider = ({ children, inactivityThreshold = 300000 }) => {
    const [isTabVisible, setIsTabVisible] = useState(true);
    const [isUserActive, setIsUserActive] = useState(true);
    const [lastActivity, setLastActivity] = useState(Date.now());
    const timeoutRef = useRef(null);

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
        // Tab Visibility
        const handleVisibilityChange = () => {
            setIsTabVisible(document.visibilityState === 'visible');
            if (document.visibilityState === 'visible') {
                handleActivity(); // Mark active when returning to tab
            }
        };

        // User Activity Events
        const activityEvents = [
            'mousedown', 'mousemove', 'keydown',
            'scroll', 'touchstart', 'click'
        ];

        document.addEventListener('visibilitychange', handleVisibilityChange);

        activityEvents.forEach(event => {
            window.addEventListener(event, handleActivity, { passive: true });
        });

        // Initial timeout set
        timeoutRef.current = setTimeout(() => {
            setIsUserActive(false);
        }, inactivityThreshold);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            activityEvents.forEach(event => {
                window.removeEventListener(event, handleActivity);
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
