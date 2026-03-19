import React from 'react';
import { useWeb3 } from '@/contexts/web3-context';
import { PositionsAccordion } from './positions-accordion';

export const Dashboard: React.FC = () => {
    const { account } = useWeb3();

    if (!account) {
return null;
}

    return (
        <div className="w-full space-y-4 animate-in fade-in duration-500">
            <PositionsAccordion walletAddress={account} />
        </div>
    );
};

export default Dashboard;
