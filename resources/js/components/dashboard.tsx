import React from 'react';
import type { ChainInfo, DonatorInfo } from '../hooks/use-all-positions';
import { PositionsAccordion } from './positions-accordion';

interface DashboardProps {
    account: string;
    positionsByChain: Record<string, ChainInfo> | null;
    donator: DonatorInfo;
    loading: boolean;
    error: string | null;
    lastFetch: number | null;
    refresh: (force?: boolean) => Promise<void>;
}

export const Dashboard: React.FC<DashboardProps> = ({
    account,
    positionsByChain,
    donator,
    loading,
    error,
    lastFetch,
    refresh,
}) => {
    return (
        <div className="w-full space-y-4 animate-in fade-in duration-500">
            <PositionsAccordion
                walletAddress={account}
                positionsByChain={positionsByChain}
                donator={donator}
                loading={loading}
                error={error}
                lastFetch={lastFetch}
                refresh={refresh}
            />
        </div>
    );
};

export default Dashboard;
