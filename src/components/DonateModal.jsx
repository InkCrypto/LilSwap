import React, { useState } from 'react';
import { Modal } from './Modal.jsx';
import { Copy, CheckCircle2, Coffee, Zap, Wallet } from 'lucide-react';
import { useToast } from '../context/ToastContext.jsx';

export const DonateModal = ({ isOpen, onClose }) => {
    const { addToast } = useToast();
    const [activeTab, setActiveTab] = useState('EVM');
    const [copiedContent, setCopiedContent] = useState(null);

    const evmAddress = "0x41dB8386872ffab478d4ce798782E71b717745dA";
    const lightningAddress = "firsttongue24@walletofsatoshi.com";

    const activeAddress = activeTab === 'EVM' ? evmAddress : lightningAddress;

    const handleCopy = (text) => {
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

                {/* Method selector */}
                <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800/50 rounded-xl">
                    <button
                        onClick={() => setActiveTab('EVM')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-medium text-sm transition-all ${activeTab === 'EVM'
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                            }`}
                    >
                        <Wallet className="w-4 h-4" />
                        EVM
                    </button>
                    <button
                        onClick={() => setActiveTab('Lightning')}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-medium text-sm transition-all ${activeTab === 'Lightning'
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                            }`}
                    >
                        <Zap className="w-4 h-4" />
                        Lightning
                    </button>
                </div>

                {/* QR Code */}
                <div className="flex flex-col items-center gap-4">
                    <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                        <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(activeAddress)}`}
                            alt={`${activeTab} QR Code`}
                            className="w-48 h-48"
                        />
                    </div>

                    <div className="text-center">
                        <p className="text-sm font-medium text-slate-900 dark:text-white mb-1">
                            {activeTab === 'EVM' ? 'Send BTC, ETH or Stablecoins' : 'Send via Lightning Network'}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {activeTab === 'EVM'
                                ? 'ERC-20 tokens only (no native BTC)'
                                : 'Scan the QR code or copy the address below'}
                        </p>
                    </div>
                </div>

                {/* Address Display & Copy */}
                <div className="flex items-center justify-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                    <p className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate">
                        {activeTab === 'EVM'
                            ? `0x${activeAddress.slice(2, 10)}...${activeAddress.slice(-6)}`
                            : activeAddress}
                    </p>
                    <button
                        onClick={() => handleCopy(activeAddress)}
                        className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors shrink-0 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
                        title="Copy address"
                    >
                        {copiedContent === activeAddress ? (
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
