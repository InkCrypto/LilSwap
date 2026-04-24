import {
    AlertTriangle,
    ArrowRight,
    Fuel,
    RefreshCw,
    Shield,
    ShieldCheck,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useWeb3 } from '../contexts/web3-context';
import { useCollateralToggleActions } from '../hooks/use-collateral-toggle-actions';
import { formatCompactNumber, formatHF, formatUSD } from '../utils/formatters';
import { getTokenLogo, onTokenImgError } from '../utils/get-token-logo';
import { InfoTooltip } from './info-tooltip';
import { Modal } from './modal';
import { Button } from './ui/button';

interface CollateralToggleModalProps {
    isOpen: boolean;
    onClose: () => void;
    asset: {
        symbol: string;
        underlyingAsset: string;
        formattedAmount: string;
        priceInUSD: string;
        reserveLiquidationThreshold?: string;
        usageAsCollateralEnabledOnUser?: boolean;
    };
    account: string | null;
    selectedNetwork: any;
    summary: {
        healthFactor: string;
        totalCollateralUSD?: string;
        totalBorrowsUSD?: string;
        currentLiquidationThreshold?: string;
    } | null;
    supplies?: any[];
    marketAssets?: any[];
    onSuccess?: () => void;
    onSwitchAsset?: (asset: any) => void;
}

export const CollateralToggleModal: React.FC<CollateralToggleModalProps> = ({
    isOpen,
    onClose,
    asset,
    account,
    selectedNetwork,
    summary,
    supplies,
    marketAssets,
    onSuccess,
    onSwitchAsset,
}) => {
    const { chainId: walletChainId, setSelectedNetwork } = useWeb3();
    const [isSuccess, setIsSuccess] = useState(false);
    const [isSwitchingChain, setIsSwitchingChain] = useState(false);

    const { isActionLoading, txError, toggleCollateral } =
        useCollateralToggleActions({
            account,
            selectedNetwork,
            onSuccess: () => {
                setIsSuccess(true);
                onSuccess?.();
                setTimeout(() => {
                    onClose();
                    setTimeout(() => setIsSuccess(false), 300);
                }, 2000);
            },
        });

    const isCurrentlyEnabled = !!asset.usageAsCollateralEnabledOnUser;
    const actionType = isCurrentlyEnabled ? 'disable' : 'enable';
    const actionLabel = actionType === 'disable' ? 'Disable' : 'Enable';
    const assetAmount = parseFloat(asset.formattedAmount || '0');
    const assetPrice = parseFloat(asset.priceInUSD || '0');
    const assetUsdValue = assetAmount * assetPrice;

    const simulation = useMemo(() => {
        if (!summary || !asset) {
            return null;
        }

        const currentHF = parseFloat(summary.healthFactor || '0');
        const totalCollateral = parseFloat(summary.totalCollateralUSD || '0');
        const totalDebt = parseFloat(summary.totalBorrowsUSD || '0');

        let avgLT = parseFloat(summary.currentLiquidationThreshold || '0');

        if (avgLT > 1) {
            avgLT = avgLT / 10000;
        }

        const assetValue =
            parseFloat(asset.formattedAmount || '0') *
            parseFloat(asset.priceInUSD || '0');

        let assetLT = parseFloat(asset.reserveLiquidationThreshold || '0');

        if (assetLT > 1) {
            assetLT = assetLT / 10000;
        }

        if (assetLT === 0) {
            assetLT = avgLT;
        }

        const currentNumerator =
            totalDebt > 0 ? currentHF * totalDebt : totalCollateral * avgLT;
        const assetContribution = assetValue * assetLT;

        let simulatedNumerator = currentNumerator;

        if (actionType === 'disable') {
            simulatedNumerator = Math.max(
                0,
                currentNumerator - assetContribution,
            );
        } else {
            simulatedNumerator = currentNumerator + assetContribution;
        }

        const simulatedHF =
            totalDebt > 0 ? simulatedNumerator / totalDebt : Infinity;

        return {
            currentHF: currentHF.toString(),
            simulatedHF:
                simulatedHF === Infinity ? 'Infinity' : simulatedHF.toString(),
            isSafe: actionType === 'enable' || simulatedHF > 1.5,
            isWarning:
                actionType === 'disable' &&
                simulatedHF <= 1.5 &&
                simulatedHF > 1.02 &&
                totalDebt > 0,
            isDanger:
                actionType === 'disable' &&
                simulatedHF <= 1.02 &&
                totalDebt > 0,
        };
    }, [summary, asset, actionType]);

    const badCollateralAssets = useMemo(() => {
        if (!supplies || !marketAssets) return [];
        return supplies.filter((s: any) => {
            const hasPositiveSupply = parseFloat(s.formattedAmount || '0') > 0 || parseFloat(s.amount || '0') > 0;
            if (!s.usageAsCollateralEnabledOnUser || !hasPositiveSupply) return false;

            const sAddr = (s.underlyingAsset || s.address || '').toLowerCase();
            const m = marketAssets.find(
                (ma: any) =>
                    (ma.underlyingAsset || ma.address || '').toLowerCase() === sAddr,
            );
            if (!m) return false;
            const ltv = parseFloat(m.baseLTVasCollateral || '0');
            return Number.isFinite(ltv) && ltv === 0;
        });
    }, [supplies, marketAssets]);

    const isCurrentAssetBad = useMemo(() => {
        const addr = (asset.underlyingAsset || '').toLowerCase();
        return badCollateralAssets.some(
            (b: any) => (b.underlyingAsset || '').toLowerCase() === addr,
        );
    }, [badCollateralAssets, asset]);

    const isBlockedByLtv0 =
        badCollateralAssets.length > 0 &&
        !(isCurrentAssetBad && actionType === 'disable');

    const ltv0Message = useMemo(() => {
        if (badCollateralAssets.length === 0) return null;

        if (isCurrentAssetBad && actionType === 'disable') {
            return (
                <div className="flex items-center gap-1.5">
                    <span>This asset has LTV 0. You must disable it as collateral.</span>
                </div>
            );
        }

        return (
            <div className="flex flex-col gap-1.5">
                <div className="leading-relaxed">
                    You have assets with LTV 0 enabled as collateral (
                    {badCollateralAssets.map((b: any, i: number) => (
                        <React.Fragment key={b.underlyingAsset || b.address}>
                            <button
                                onClick={() => onSwitchAsset?.(b)}
                                className="font-bold text-red-600 dark:text-red-400 hover:underline decoration-red-500/50 underline-offset-2 transition-all cursor-pointer"
                            >
                                {b.symbol}
                            </button>
                            {i < badCollateralAssets.length - 1 ? ', ' : ''}
                        </React.Fragment>
                    ))}
                    ).
                </div>
                <div className="text-xs font-bold">
                    Aave requires you to disable them before managing other collateral.
                </div>
            </div>
        );
    }, [badCollateralAssets, isCurrentAssetBad, actionType, onSwitchAsset]);

    const handleConfirm = () => {
        toggleCollateral(asset.underlyingAsset, !isCurrentlyEnabled);
    };

    const handleSwitchChain = async () => {
        if (!selectedNetwork) {
            return;
        }

        setIsSwitchingChain(true);

        try {
            await setSelectedNetwork(selectedNetwork.key);
        } finally {
            setIsSwitchingChain(false);
        }
    };

    const hfSim = simulation;
    const isWrongNetwork =
        walletChainId !== null &&
        selectedNetwork &&
        walletChainId !== selectedNetwork.chainId;
    const healthFactorTone = hfSim?.isDanger
        ? 'text-red-500'
        : hfSim?.isWarning
            ? 'text-amber-500'
            : 'text-emerald-500';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Review tx ${asset.symbol}`}
            maxWidth="460px"
            headerBorder={false}
            preventAutoFocus={true}
        >
            <div className="space-y-3 p-3">
                {isSuccess ? (
                    <div className="flex animate-in flex-col items-center justify-center py-12 text-center duration-300 fade-in zoom-in">
                        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                            <ShieldCheck className="h-7 w-7 text-emerald-500" />
                        </div>
                        <h3 className="mb-1 text-lg font-bold text-slate-900 dark:text-white">
                            Success!
                        </h3>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            Collateral status updated for {asset.symbol}.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="rounded-xl border border-border-light bg-slate-50 p-1 px-2.5 dark:border-slate-700 dark:bg-slate-800">
                            <div className="flex items-center gap-3">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-light bg-slate-100 dark:border-slate-600/30 dark:bg-slate-700/50">
                                    <img
                                        src={getTokenLogo(asset.symbol)}
                                        alt={asset.symbol}
                                        className="h-full w-full object-cover"
                                        onError={onTokenImgError(asset.symbol)}
                                    />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline justify-between">
                                        <div className="text-lg font-bold text-slate-900 dark:text-white">
                                            {asset.symbol}
                                        </div>
                                        <div className="text-sm font-bold text-slate-900 dark:text-white">
                                            {formatCompactNumber(asset.formattedAmount)}{' '}
                                            {asset.symbol}
                                        </div>
                                    </div>
                                    <div className="flex items-baseline justify-between mt-0.5">
                                        <div className="text-xs font-medium text-slate-500">
                                            {formatUSD(assetUsdValue)}
                                        </div>
                                        <div className="text-xs font-medium text-slate-500">
                                            Collateral asset
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-1 mb-2 px-3">
                            <div className="mb-1 text-sm font-bold text-slate-600 dark:text-slate-400">
                                Transaction overview
                            </div>
                            <div className="space-y-2.5 px-1">
                                <div className="flex items-center justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                    <div className="flex items-center gap-1.5">
                                        <span>Collateralization</span>
                                        <InfoTooltip
                                            content="Whether this supplied asset is enabled as collateral for your loans."
                                            size={12}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1.5 text-right">
                                        <span
                                            className={
                                                isCurrentlyEnabled
                                                    ? 'text-emerald-500'
                                                    : 'text-slate-400'
                                            }
                                        >
                                            {isCurrentlyEnabled
                                                ? 'Enabled'
                                                : 'Disabled'}
                                        </span>
                                        <ArrowRight className="h-3 w-3 text-slate-400" />
                                        <span
                                            className={
                                                !isCurrentlyEnabled
                                                    ? 'text-emerald-500'
                                                    : 'font-bold text-amber-500'
                                            }
                                        >
                                            {!isCurrentlyEnabled
                                                ? 'Enabled'
                                                : 'Disabled'}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                    <div className="flex items-center gap-1.5">
                                        <span>Health factor</span>
                                        <InfoTooltip
                                            content="Your estimated Health Factor after this collateral setting changes."
                                            size={12}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1.5 text-right">
                                        <span className="text-slate-900 dark:text-slate-100">
                                            {formatHF(hfSim?.currentHF)}
                                        </span>
                                        <ArrowRight className="h-3 w-3 text-slate-400" />
                                        <span
                                            className={`font-bold ${healthFactorTone}`}
                                        >
                                            {formatHF(hfSim?.simulatedHF)}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                    <div className="flex items-center gap-1.5">
                                        <span>Supply balance</span>
                                        <InfoTooltip
                                            content="The supplied balance affected by this collateral setting."
                                            size={12}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1.5 text-right text-slate-900 dark:text-slate-100">
                                        <div className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full border border-slate-200 dark:border-slate-700">
                                            <img
                                                src={getTokenLogo(asset.symbol)}
                                                alt=""
                                                className="h-full w-full object-cover"
                                                onError={onTokenImgError(
                                                    asset.symbol,
                                                )}
                                            />
                                        </div>
                                        <span>
                                            {formatCompactNumber(
                                                asset.formattedAmount,
                                            )}{' '}
                                            {asset.symbol}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between text-[13px] font-medium text-slate-600 dark:text-slate-300">
                                    <div className="flex items-center gap-1.5">
                                        <Fuel className="h-3.5 w-3.5 text-slate-400" />
                                        <span>Network costs</span>
                                    </div>
                                    <span className="text-slate-900 dark:text-slate-100">
                                        &lt; $0.01
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col items-center justify-center py-1">
                            <div
                                className={`text-xs font-bold text-center ${isBlockedByLtv0 ? 'text-red-500' : 'text-amber-500'}`}
                            >
                                {ltv0Message ||
                                    (actionType === 'disable'
                                        ? 'Disabling collateral affects borrowing power and HF.'
                                        : 'Enabling collateral improves borrowing power and HF.')}
                            </div>
                        </div>

                        {txError && (
                            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                                <p className="text-xs font-medium text-red-800 dark:text-red-300">
                                    {txError}
                                </p>
                            </div>
                        )}

                        <div className="flex flex-col items-center gap-2 pt-1">
                            {isWrongNetwork ? (
                                <Button
                                    onClick={handleSwitchChain}
                                    disabled={isSwitchingChain}
                                    className="h-auto rounded-xl border-amber-600 bg-amber-500 px-6 py-3 font-bold text-white hover:bg-amber-600"
                                >
                                    {isSwitchingChain ? (
                                        <>
                                            <RefreshCw className="h-4 w-4 animate-spin" />
                                            Switching...
                                        </>
                                    ) : (
                                        `Switch to ${selectedNetwork?.name || 'Correct Network'}`
                                    )}
                                </Button>
                            ) : (
                                <Button
                                    onClick={handleConfirm}
                                    disabled={
                                        isActionLoading ||
                                        hfSim?.isDanger ||
                                        isBlockedByLtv0
                                    }
                                    className={`h-auto rounded-xl px-8 py-3 font-bold ${hfSim?.isDanger || isBlockedByLtv0
                                        ? 'cursor-not-allowed bg-slate-200 text-slate-500 shadow-none dark:bg-slate-800 dark:text-slate-500'
                                        : ''
                                        }`}
                                >
                                    {isActionLoading ? (
                                        <div className="flex items-center gap-2">
                                            <RefreshCw className="h-4 w-4 animate-spin" />
                                            <span>Confirm in Wallet...</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <Shield className="h-4 w-4" />
                                            <span>{actionLabel} {asset.symbol} as collateral</span>
                                        </div>
                                    )}
                                </Button>
                            )}

                            {actionType === 'disable' && hfSim?.isDanger && (
                                <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-red-600 dark:text-red-400">
                                    <span>
                                        Blocked: risk of immediate liquidation
                                    </span>
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};
