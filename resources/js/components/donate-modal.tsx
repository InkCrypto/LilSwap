import React, { useState } from 'react';
import { Modal } from './modal';
import { Copy, CheckCircle2, Coffee } from 'lucide-react';
import { useToast } from '../contexts/toast-context';

interface DonateModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const DonateModal: React.FC<DonateModalProps> = ({ isOpen, onClose }) => {
    const { addToast } = useToast();
    const [copiedContent, setCopiedContent] = useState<string | null>(null);

    const evmAddress = "0x41dB8386872ffab478d4ce798782E71b717745dA";

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedContent(text);
        addToast({ title: 'Copied!', message: 'Address copied to clipboard.', type: 'success' });
        setTimeout(() => setCopiedContent(null), 2000);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={
            <div className="flex items-center gap-2">
                <Coffee className="w-5 h-5 text-purple-500 dark:text-[#2EBDE3]" />
                <span>Buy us a coffee</span>
            </div>
        } maxWidth="400px">
            <div className="p-4 sm:p-5 flex flex-col gap-6">
                <div className="bg-linear-to-br from-primary/10 via-fuchsia-500/10 to-transparent border border-primary/20 rounded-xl p-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-primary">
                        <span className="text-xl">🏆</span>
                        <span className="text-sm font-extrabold uppercase tracking-wider">Donator Rewards</span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                        Donate <strong className="text-primary font-bold">$1 or more</strong> in bluechip ERC-20 tokens to unlock a <strong className="text-primary font-bold">10% discount</strong> on any fee in the app for a limited time! 💜
                    </p>
                    <div className="flex items-start gap-2 mt-2 text-[10px] text-slate-500 dark:text-slate-400 bg-white/50 dark:bg-black/20 p-2 rounded-lg shadow-sm">
                        <span className="text-xs">⚡</span>
                        <p className="font-medium">Donator detection happens automatically every ~5 minutes after your transaction confirms.</p>
                    </div>
                </div>

                <div className="flex flex-col items-center gap-4">
                    <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                        <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(evmAddress)}`}
                            alt="EVM QR Code"
                            className="w-48 h-48"
                        />
                    </div>
                    <div className="text-center">
                        <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                            Send BTC, ETH or Stablecoins
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            ERC-20 tokens only (no native BTC)
                        </p>
                    </div>
                </div>

                <div className="flex items-center justify-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">
                        {`0x${evmAddress.slice(2, 10)}...${evmAddress.slice(-6)}`}
                    </p>
                    <button
                        onClick={() => handleCopy(evmAddress)}
                        className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors shrink-0 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
                        title="Copy address"
                    >
                        {copiedContent === evmAddress ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                            <Copy className="w-4 h-4" />
                        )}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default DonateModal;
