import React from 'react';
import { Network } from 'lucide-react';
import { useWeb3 } from '../context/web3Context';
import { PositionsAccordion } from './PositionsAccordion.jsx';

export const Dashboard = () => {
    const { account } = useWeb3();

    if (!account) return null;

    return (
        <div className="w-full space-y-6 animate-in fade-in duration-500">
            <PositionsAccordion userAddress={account} />
        </div>
    );
};
