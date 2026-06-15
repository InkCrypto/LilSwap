import { AlertTriangle } from 'lucide-react';

import { formatHF } from '../utils/formatters';
import { Modal } from './modal';
import { Button } from './ui/button';

interface LowHealthFactorConfirmationModalProps {
    isOpen: boolean;
    healthFactor: number;
    onCancel: () => void;
    onConfirm: () => void;
}

export function LowHealthFactorConfirmationModal({
    isOpen,
    healthFactor,
    onCancel,
    onConfirm,
}: LowHealthFactorConfirmationModalProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            title="Review Health Factor change"
            maxWidth="420px"
        >
            <div className="space-y-4 p-4">
                <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/30">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                    <div className="space-y-1">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                            Health Factor after swap: {formatHF(healthFactor)}
                        </p>
                        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                            This swap lowers your safety margin. Review the new
                            Health Factor before continuing.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <Button
                        variant="outline"
                        onClick={onCancel}
                        className="h-10 rounded-xl"
                    >
                        Cancel
                    </Button>
                    <Button onClick={onConfirm} className="h-10 rounded-xl">
                        Continue
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
