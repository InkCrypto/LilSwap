import React from 'react';
import { Network } from 'lucide-react';
import { useWeb3 } from '../context/web3Context';
import { PositionsAccordion } from './PositionsAccordion.jsx';

export const Dashboard = () => {
    const { account } = useWeb3();

    if (!account) return null;

    return (
        <div className="w-full space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Network className="w-5 h-5 text-purple-400" /> Multi-Chain Positions
                </h2>
            </div>
            <PositionsAccordion userAddress={account} />
        </div>
    );
};
