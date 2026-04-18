import { CheckCircle2, Coffee, Copy, ExternalLink, Info, Trophy, Wallet } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { getConnectorClient } from 'wagmi/actions';
import { getAddress, parseAbi, parseUnits } from 'viem';
import { sendTransaction, writeContract } from 'viem/actions';
import { useToast } from '../contexts/toast-context';
import { useDonationVerification } from '../contexts/donation-verification-context';
import { useWeb3, wagmiConfig } from '../contexts/web3-context';
import {
    DONATION_CHAINS,
    DONATION_MIN_USD,
    DONATION_WALLET,
    DonationTokenKey,
    getDonationAssetConfig,
    getDonationChainConfig,
    getDonationMarket,
} from '../constants/donations';
import { getDonationPreflight, verifyDonationByHash } from '../services/api';
import { mapErrorToUserFriendly } from '../utils/error-mapping';
import { getTokenLogo } from '../utils/get-token-logo';
import { isUserRejectedError } from '../utils/logger';
import { normalizeDecimalInput } from '../utils/normalize-decimal-input';
import { formatCompactToken, formatUSD } from '../utils/formatters';
import { Modal } from './modal';
import { Button } from './ui/button';
import { VerifyDonationModal } from './verify-donation-modal';

interface DonateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onVerified?: () => void | Promise<void>;
    onDonated?: (txHash: string, chainId: number) => void;
    onOpenVerify?: () => void;
}

type VerifyStatus = {
    kind: 'idle' | 'success' | 'pending' | 'error';
    message: string;
    chainId?: number | null;
    txHash?: string | null;
};

type BalanceStatus = {
    kind: 'idle' | 'checking' | 'ok' | 'insufficient' | 'unavailable' | 'native_unavailable';
    balance?: bigint | null;
    source?: string | null;
    usdPrice?: number | null;
    tokenDecimals?: number | null;
};

const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const QUICK_AMOUNTS = ['1', '2', '5', '10'] as const;

const truncate = (value: string) => `${value.slice(0, 10)}...${value.slice(-8)}`;
const getErrorMessage = (error: any) => {
    const raw = error?.response?.data?.message || error?.shortMessage || error?.message || 'Request failed.';
    return mapErrorToUserFriendly(raw) || raw;
};
const getAmountButtonClass = (selected: boolean) => `inline-flex h-10 items-center justify-center rounded-lg px-3.5 text-sm font-semibold transition ${selected
        ? 'border border-transparent text-white shadow-[0_10px_30px_-18px_rgba(111,76,255,0.95)]'
        : 'border border-transparent bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/70'
    }`;
const getTokenSortWeight = (tokenKey: DonationTokenKey) => {
    if (tokenKey === 'usdc') return 0;
    if (tokenKey === 'usdt') return 1;
    return 2;
};
const getPreferredTokenKey = (chainId: number): DonationTokenKey => {
    const chainConfig = getDonationChainConfig(chainId);
    if (!chainConfig) return 'native';
    return (chainConfig.assets.find((asset) => asset.tokenKey === 'usdc')?.tokenKey || chainConfig.assets[0]?.tokenKey || 'native') as DonationTokenKey;
};

export const DonateModal: React.FC<DonateModalProps> = ({ isOpen, onClose, onVerified, onDonated, onOpenVerify }) => {
    const { addToast } = useToast();
    const { trackDonation } = useDonationVerification();
    const { account, chainId, walletClient, connectWallet, isConnected } = useWeb3();

    const [copiedContent, setCopiedContent] = useState<string | null>(null);
    const [selectedChainId, setSelectedChainId] = useState<number>(8453);
    const [selectedTokenKey, setSelectedTokenKey] = useState<DonationTokenKey>('usdc');
    const [selectedAmountPreset, setSelectedAmountPreset] = useState<string>('1');
    const [customAmount, setCustomAmount] = useState('');
    const [debouncedCustomAmount, setDebouncedCustomAmount] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [latestTxHash, setLatestTxHash] = useState<string | null>(null);
    const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({ kind: 'idle', message: '' });
    const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>({ kind: 'idle', balance: null });

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedCustomAmount(customAmount), 500);
        return () => clearTimeout(timer);
    }, [customAmount]);

    const selectedChain = useMemo(
        () => DONATION_CHAINS.find((chain) => chain.chainId === selectedChainId) || DONATION_CHAINS[0],
        [selectedChainId]
    );
    const availableAssets = useMemo(
        () => [...selectedChain.assets].sort((left, right) => getTokenSortWeight(left.tokenKey) - getTokenSortWeight(right.tokenKey)),
        [selectedChain.assets]
    );
    const selectedAsset = getDonationAssetConfig(selectedChainId, selectedTokenKey);
    const selectedMarket = getDonationMarket(selectedChainId);
    const donationAmount = selectedAmountPreset === 'custom' ? debouncedCustomAmount : selectedAmountPreset;
    const displayedRecipient = truncate(DONATION_WALLET);
    const selectedAssetUsdPrice = selectedAsset?.type === 'erc20' ? 1 : balanceStatus.usdPrice ?? null;
    const donationUsdAmount = Number(donationAmount || '0');
    const effectiveTokenDecimals = balanceStatus.tokenDecimals ?? selectedAsset?.decimals ?? 18;
    const donationTokenAmount = useMemo(() => {
        if (!selectedAsset || !donationAmount || donationUsdAmount <= 0) return null;
        if (selectedAsset.type === 'erc20') return donationAmount;
        if (!selectedAssetUsdPrice || selectedAssetUsdPrice <= 0) return null;
        return (donationUsdAmount / selectedAssetUsdPrice).toFixed(8).replace(/\.?0+$/, '');
    }, [donationAmount, donationUsdAmount, selectedAsset, selectedAssetUsdPrice]);

    useEffect(() => {
        if (!isOpen) return;
        if (!availableAssets.some((asset) => asset.tokenKey === selectedTokenKey)) {
            setSelectedTokenKey(getPreferredTokenKey(selectedChainId));
        }
    }, [availableAssets, isOpen, selectedChainId, selectedTokenKey]);

    useEffect(() => {
        if (!isOpen) return;
        setSelectedAmountPreset('1');
        setCustomAmount('');
        setLatestTxHash(null);
        setVerifyStatus({ kind: 'idle', message: '' });
        setBalanceStatus({ kind: 'idle', balance: null });
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !isConnected || !account || !selectedAsset || isSubmitting) {
            if (!isSubmitting) setBalanceStatus({ kind: 'idle', balance: null });
            return;
        }

        let cancelled = false;
        const shouldCheckBalance = selectedAsset.type === 'erc20' || donationUsdAmount > 0;
        setBalanceStatus({ kind: shouldCheckBalance ? 'checking' : 'idle', balance: null });

        void (async () => {
            try {
                const response = await getDonationPreflight({
                    walletAddress: account,
                    chainId: selectedChainId,
                    tokenKey: selectedTokenKey,
                });

                if (cancelled) return;

                const balance = BigInt(response.balanceRaw || '0');
                const usdPrice = response.usdPrice == null ? null : Number(response.usdPrice);
                const tokenDecimals = Number.isFinite(Number(response.decimals)) ? Number(response.decimals) : selectedAsset.decimals;

                if (selectedAsset.type === 'native' && !response.nativePriceAvailable) {
                    setBalanceStatus({
                        kind: 'native_unavailable',
                        balance,
                        source: response.source || null,
                        usdPrice: null,
                        tokenDecimals,
                    });
                    return;
                }

                if (!shouldCheckBalance || donationUsdAmount <= 0) {
                    setBalanceStatus({
                        kind: 'ok',
                        balance,
                        source: response.source || null,
                        usdPrice,
                        tokenDecimals,
                    });
                    return;
                }

                // Calculate required amount locally using fetched price to avoid loop
                let requiredTokenAmount: string | null = null;
                if (selectedAsset.type === 'erc20') {
                    requiredTokenAmount = donationAmount;
                } else if (usdPrice && usdPrice > 0) {
                    requiredTokenAmount = (donationUsdAmount / usdPrice).toFixed(8);
                }

                if (!requiredTokenAmount || Number(requiredTokenAmount) <= 0) {
                    setBalanceStatus({
                        kind: 'ok',
                        balance,
                        source: response.source || null,
                        usdPrice,
                    });
                    return;
                }

                const requiredAmount = parseUnits(requiredTokenAmount, tokenDecimals);

                setBalanceStatus({
                    kind: balance >= requiredAmount ? 'ok' : 'insufficient',
                    balance,
                    source: response.source || null,
                    usdPrice,
                    tokenDecimals,
                });
            } catch {
                if (!cancelled) {
                    setBalanceStatus({ kind: 'unavailable', balance: null });
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [account, donationUsdAmount, isConnected, isOpen, selectedAsset, selectedChainId, selectedTokenKey]);

    const handleCopy = (text: string, label = 'Copied!') => {
        navigator.clipboard.writeText(text);
        setCopiedContent(text);
        addToast({ title: label, message: 'Copied to clipboard.', type: 'success' });
        setTimeout(() => setCopiedContent(null), 2000);
    };

    const explorerHref = verifyStatus.chainId && verifyStatus.txHash
        ? `${getDonationMarket(verifyStatus.chainId)?.explorer}/tx/${verifyStatus.txHash}`
        : latestTxHash && selectedMarket
            ? `${selectedMarket.explorer}/tx/${latestTxHash}`
            : null;

    const handleSuccessfulVerification = async () => {
        addToast({ title: 'Donation verified', message: 'Your 10% donor discount is active.', type: 'success' });
        if (onVerified) await onVerified();
    };

    const handleVerifyByHash = async (txHash: string, retryCount = 0) => {
        const MAX_RETRIES = 5;
        const RETRY_DELAY_MS = 4000;
        try {
            const response = await verifyDonationByHash({
                txHash,
                walletAddress: account || undefined,
                chainId: selectedChainId
            });
            setVerifyStatus({
                kind: 'success',
                message: `Donation Verified! Your 10% discount is active!`,
                txHash: response.txHash || txHash,
                chainId: response.chainId,
            });
            await handleSuccessfulVerification();
        } catch (error: any) {
            const payload = error?.response?.data;
            const isPending = payload?.status === 'pending';

            if (isPending && retryCount < MAX_RETRIES) {
                // Transaction on-chain but not yet confirmed — retry for in-session feedback.
                // The global DonationVerificationContext also watches this hash independently.
                setVerifyStatus({
                    kind: 'pending',
                    message: `Waiting for network confirmation... (${retryCount + 1}/${MAX_RETRIES})`,
                    txHash: payload?.txHash || txHash,
                    chainId: payload?.chainId || selectedChainId,
                });
                setTimeout(() => handleVerifyByHash(txHash, retryCount + 1), RETRY_DELAY_MS);
                return;
            }

            setVerifyStatus({
                kind: isPending ? 'pending' : 'error',
                message: payload?.message || getErrorMessage(error),
                txHash: payload?.txHash || txHash,
                chainId: payload?.chainId || selectedChainId,
            });
        }
    };

    const handleDonateNow = async () => {
        if (!isConnected) {
            addToast({ title: 'Wallet required', message: 'Connect your wallet before donating.', type: 'error' });
            return;
        }

        if (!account || !walletClient || !selectedAsset) {
            addToast({ title: 'Wallet not ready', message: 'Wallet connection is not ready yet. Try again in a moment.', type: 'error' });
            return;
        }
        if (!donationAmount || Number(donationAmount) <= 0) {
            addToast({ title: 'Invalid amount', message: 'Enter a valid donation amount.', type: 'error' });
            return;
        }
        if (!donationTokenAmount || Number(donationTokenAmount) <= 0) {
            addToast({ title: 'Price unavailable', message: 'Unable to calculate this donation amount right now.', type: 'error' });
            return;
        }
        if (balanceStatus.kind === 'native_unavailable') {
            addToast({ title: 'Native donation unavailable', message: 'This native token is temporarily unavailable. Try a stable token instead.', type: 'info' });
            return;
        }
        if (balanceStatus.kind === 'insufficient') {
            addToast({ title: 'Insufficient balance', message: `Not enough ${selectedAsset.symbol} balance for this donation.`, type: 'info' });
            return;
        }

        setIsSubmitting(true);
        setVerifyStatus({ kind: 'pending', message: 'Verifying donation status...' });

        try {
            const currentChainId = await walletClient.getChainId();
            if (currentChainId !== selectedChainId) {
                addToast({ title: 'Switching network', message: `Switching your wallet to ${selectedChain.label}...`, type: 'info' });
                await walletClient.switchChain({ id: selectedChainId });
            }

            const activeWalletClient = await getConnectorClient(wagmiConfig, {
                account: getAddress(account),
                chainId: selectedChainId as any,
            });

            let txHash: string;

            if (selectedAsset.type === 'native') {
                txHash = await sendTransaction(activeWalletClient, {
                    account: getAddress(account),
                    to: getAddress(DONATION_WALLET),
                    value: parseUnits(donationTokenAmount, effectiveTokenDecimals),
                });
            } else {
                txHash = await writeContract(activeWalletClient, {
                    account: getAddress(account),
                    address: getAddress(selectedAsset.address!),
                    abi: ERC20_ABI,
                    functionName: 'transfer',
                    args: [getAddress(DONATION_WALLET), parseUnits(donationTokenAmount, effectiveTokenDecimals)],
                });
            }

            setLatestTxHash(txHash);
            addToast({ title: 'Transaction submitted', message: 'Your donation was sent. Verifying on-chain...', type: 'info' });

            // Register with the global tracker — survives modal close
            trackDonation({ txHash, chainId: selectedChainId, walletAddress: account || undefined });

            if (onDonated) {
                onDonated(txHash, selectedChainId);
            } else {
                await handleVerifyByHash(txHash);
            }
        } catch (error: any) {
            if (isUserRejectedError(error)) {
                addToast({ title: 'Info', message: 'Transaction rejected in wallet.', type: 'info' });
            } else {
                addToast({ title: 'Donation failed', message: getErrorMessage(error), type: 'error' });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={(
                <div className="flex items-center gap-2">
                    <Coffee className="h-5 w-5 text-primary" />
                    <span>Donate</span>
                </div>
            )}
            maxWidth="400px"
            headerBorder={false}
        >
            <div className="flex flex-col gap-4 p-4 pt-3">
                <div className="-mx-4 -mt-2 flex flex-col gap-2 bg-linear-to-br from-primary/10 via-fuchsia-500/10 to-transparent px-4 py-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-primary">
                            <Trophy className="h-4.5 w-4.5 shrink-0" />
                            <span className="text-sm font-extrabold uppercase tracking-wider">Donator Rewards</span>
                        </div>
                        <div className="space-y-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                            <p>
                                Unlock a <strong className="font-bold text-primary">10% fee discount</strong> by donating <strong className="font-bold text-primary">${DONATION_MIN_USD}+</strong>.
                            </p>
                            <p>
                                We verify donation right after you send it, and your discount is activated once the transaction is confirmed onchain.
                            </p>
                        </div>
                    </div>
                </div>

                <section className="flex flex-col gap-3">
                    <div className="-mx-4 bg-slate-50 dark:bg-slate-900/40 px-4 py-1.5 border-t border-b border-slate-100 dark:border-slate-800">
                        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/80 sm:text-xs">Network</span>
                    </div>

                    <div className="flex flex-wrap gap-x-2 gap-y-2.5">
                        {DONATION_CHAINS.map((chain) => (
                            <Button
                                key={chain.chainId}
                                type="button"
                                onClick={() => {
                                    setSelectedChainId(chain.chainId);
                                    setSelectedTokenKey(getPreferredTokenKey(chain.chainId));
                                    setVerifyStatus({ kind: 'idle', message: '' });
                                }}
                                variant={selectedChainId === chain.chainId ? 'default' : 'ghost'}
                                className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-left transition ${selectedChainId === chain.chainId
                                        ? 'border-transparent text-white shadow-[0_10px_30px_-18px_rgba(111,76,255,0.95)]'
                                        : 'border-transparent bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/70'
                                    }`}
                            >
                                {getDonationMarket(chain.chainId)?.icon && (
                                    <img
                                        src={getDonationMarket(chain.chainId)?.icon}
                                        alt={chain.label}
                                        className="h-4 w-4 shrink-0 rounded-full"
                                        onError={(e) => (e.currentTarget.style.display = 'none')}
                                    />
                                )}
                                <span className="text-xs font-semibold">{chain.label}</span>
                            </Button>
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <div className="-mx-4 bg-slate-50 dark:bg-slate-900/40 px-4 py-1.5 border-t border-b border-slate-100 dark:border-slate-800">
                        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/80 sm:text-xs">Token</span>
                    </div>

                    <div className="flex flex-wrap gap-x-2.5 gap-y-2">
                        {availableAssets.map((asset) => (
                            <Button
                                key={`${selectedChainId}-${asset.tokenKey}`}
                                type="button"
                                onClick={() => setSelectedTokenKey(asset.tokenKey)}
                                variant={selectedTokenKey === asset.tokenKey ? 'default' : 'ghost'}
                                className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition ${selectedTokenKey === asset.tokenKey
                                        ? 'border-transparent text-white shadow-[0_10px_30px_-18px_rgba(111,76,255,0.95)]'
                                        : 'border-transparent bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/70'
                                    }`}
                            >
                                <img
                                    src={getTokenLogo(asset.symbol)}
                                    alt={asset.symbol}
                                    className="h-4 w-4 shrink-0 rounded-full bg-white/90"
                                />
                                <span>{asset.symbol}</span>
                            </Button>
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-3">
                    <div className="-mx-4 bg-slate-50 dark:bg-slate-900/40 px-4 py-1.5 border-t border-b border-slate-100 dark:border-slate-800">
                        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-primary/80 sm:text-xs">Amount</span>
                    </div>

                    <div className="flex flex-wrap gap-x-1.5 gap-y-2">
                        {QUICK_AMOUNTS.map((amount) => (
                            <Button
                                key={amount}
                                type="button"
                                onClick={() => {
                                    setSelectedAmountPreset(amount);
                                    setCustomAmount('');
                                }}
                                variant={selectedAmountPreset === amount ? 'default' : 'ghost'}
                                className={getAmountButtonClass(selectedAmountPreset === amount)}
                            >
                                ${amount}
                            </Button>
                        ))}

                        <div className="relative h-10 w-24 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800/70">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500 dark:text-slate-400">$</span>
                            <input
                                type="text"
                                inputMode="decimal"
                                value={selectedAmountPreset === 'custom' ? customAmount : ''}
                                onChange={(event) => {
                                    const normalized = normalizeDecimalInput(event.target.value);
                                    setSelectedAmountPreset('custom');
                                    setCustomAmount(normalized);
                                }}
                                onPaste={(event) => {
                                    const pastedText = event.clipboardData?.getData('text') || '';
                                    event.preventDefault();
                                    const normalized = normalizeDecimalInput(pastedText);
                                    setSelectedAmountPreset('custom');
                                    setCustomAmount(normalized);
                                }}
                                onFocus={() => setSelectedAmountPreset('custom')}
                                placeholder="Custom"
                                className="h-full w-full border-none bg-transparent rounded-lg pl-6 pr-3 text-[10px] font-bold text-slate-900 dark:text-white focus:outline-none placeholder:text-slate-400"
                            />
                        </div>
                    </div>
                </section>

                <div className="flex-1 min-h-4" />

                <Button
                    type="button"
                    onClick={isConnected ? handleDonateNow : connectWallet}
                    disabled={isSubmitting || balanceStatus.kind === 'checking' || balanceStatus.kind === 'insufficient' || balanceStatus.kind === 'native_unavailable'}
                    className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {!isConnected
                        ? (
                            <>
                                <Wallet className="h-4 w-4" />
                                Connect wallet to donate
                            </>
                        )
                        : isSubmitting
                            ? 'Submitting...'
                            : balanceStatus.kind === 'checking'
                                ? 'Checking balance...'
                                : balanceStatus.kind === 'native_unavailable'
                                    ? 'Native donation unavailable'
                                    : balanceStatus.kind === 'insufficient'
                                        ? 'Insufficient balance'
                                        : `Donate ${formatUSD(donationUsdAmount || DONATION_MIN_USD)}`}
                </Button>

                {latestTxHash && verifyStatus.kind === 'success' && (
                    <div className={`rounded-xl border px-4 py-3 text-sm ${verifyStatus.kind === 'success'
                            ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-300'
                            : verifyStatus.kind === 'pending'
                                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300'
                                : verifyStatus.kind === 'error'
                                    ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300'
                                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300'
                        }`}>
                        <div className="flex flex-col gap-2">
                            {verifyStatus.message && <p>{verifyStatus.message}</p>}
                            {(verifyStatus.txHash || latestTxHash) && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-xs">{truncate(verifyStatus.txHash || latestTxHash || '')}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleCopy(verifyStatus.txHash || latestTxHash || '', 'Tx hash copied')}
                                        className="rounded-lg p-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                                        title="Copy transaction hash"
                                    >
                                        {copiedContent === (verifyStatus.txHash || latestTxHash)
                                            ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            : <Copy className="h-4 w-4" />}
                                    </button>
                                    {explorerHref && (
                                        <a
                                            href={explorerHref}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs font-semibold underline"
                                        >
                                            View on explorer
                                            <ExternalLink className="h-3.5 w-3.5" />
                                        </a>
                                    )}
                                    {verifyStatus.kind !== 'success' && latestTxHash && (
                                        <button
                                            type="button"
                                            onClick={() => handleVerifyByHash(latestTxHash)}
                                            className="text-xs font-semibold underline"
                                        >
                                            Retry verification
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Already donated? link */}
                <div className="flex flex-col items-center pt-2">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                        Already donated?{' '}
                        <button
                            type="button"
                            onClick={onOpenVerify}
                            className="font-bold text-primary hover:underline hover:text-primary-hover transition-colors"
                        >
                            Verify your donation
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default DonateModal;
