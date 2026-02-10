import { createContext, useContext } from 'react';

export const Web3Context = createContext(null);

export const useWeb3 = () => {
    const context = useContext(Web3Context);
    if (!context) {
        throw new Error('useWeb3 must be used within a Web3Provider');
    }
    return context;
};
