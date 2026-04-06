import { CheckCircle2, Coffee, Copy, Info, Trophy } from 'lucide-react';
import React, { useState } from 'react';
import { useToast } from '../contexts/toast-context';
import { Modal } from './modal';

interface DonateModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const DonateModal: React.FC<DonateModalProps> = ({ isOpen, onClose }) => {
    const { addToast } = useToast();
    const [copiedContent, setCopiedContent] = useState<string | null>(null);

    const evmAddress = '0x41dB8386872ffab478d4ce798782E71b717745dA';

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedContent(text);
        addToast({ title: 'Copied!', message: 'Address copied to clipboard.', type: 'success' });
        setTimeout(() => setCopiedContent(null), 2000);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={
                <div className="flex items-center gap-2">
                    <Coffee className="h-5 w-5 text-purple-500 dark:text-[#2EBDE3]" />
                    <span>Buy us a coffee</span>
                </div>
            }
            maxWidth="400px"
            headerBorder={false}
        >
            <div className="flex flex-col gap-5 p-4 pt-3 sm:p-5 sm:pt-3">
                <div className="-mx-4 -mt-2 flex flex-col gap-2 bg-linear-to-br from-primary/10 via-fuchsia-500/10 to-transparent px-4 py-4 sm:-mx-5 sm:px-5">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-primary">
                            <Trophy className="h-4.5 w-4.5 shrink-0" />
                            <span className="text-sm font-extrabold uppercase tracking-wider">Donator Rewards</span>
                        </div>
                        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                            Unlock a <strong className="font-bold text-primary">10% fee discount</strong> for a limited time by donating <strong className="font-bold text-primary">$1 or more</strong> in stablecoins, ETH, or BTC wrappers.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col items-center gap-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(evmAddress)}`}
                            alt="EVM QR Code"
                            className="h-48 w-48"
                        />
                    </div>
                    <div className="text-center">
                        <p className="mb-1 text-sm font-medium text-slate-900 dark:text-white">
                            Send Stablecoins, ETH or BTC
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            ERC-20 tokens only (no native BTC)
                        </p>
                    </div>
                </div>

                <div className="mx-auto inline-flex max-w-full items-center justify-center gap-2 rounded-md border border-slate-200/70 bg-slate-50 px-3 py-2 dark:border-slate-700/70 dark:bg-slate-800/30">
                    <p className="truncate font-mono text-sm text-slate-600 dark:text-slate-300">
                        {`0x${evmAddress.slice(2, 10)}...${evmAddress.slice(-6)}`}
                    </p>
                    <button
                        onClick={() => handleCopy(evmAddress)}
                        className="shrink-0 rounded-sm p-1 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
                        title="Copy address"
                    >
                        {copiedContent === evmAddress ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                            <Copy className="h-4 w-4" />
                        )}
                    </button>
                </div>

                <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <p className="font-medium">
                        Donator detection happens automatically within up to 15 minutes after your transaction confirms, usually in under 5 minutes.
                    </p>
                </div>
            </div>
        </Modal>
    );
};

export default DonateModal;
