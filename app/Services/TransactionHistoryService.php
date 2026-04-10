<?php

namespace App\Services;

use App\Models\Transaction;

class TransactionHistoryService
{
    /**
     * @return array{transactions: array<int, array<string, mixed>>, hasMore: bool, offset: int, limit: int}
     */
    public function fetch(string $walletAddress, int $limit = 20, int $offset = 0): array
    {
        $normalizedWallet = strtolower($walletAddress);
        $safeLimit = max(1, min($limit, 100));
        $safeOffset = max(0, $offset);

        $rows = Transaction::where('wallet_address', $normalizedWallet)
            ->where(function ($query) {
                $query->whereNotNull('tx_hash')
                    ->orWhere('tx_status', 'HASH_MISSING');
            })
            ->orderBy('created_at', 'desc')
            ->offset($safeOffset)
            ->limit($safeLimit + 1)
            ->get([
                'id',
                'tx_hash',
                'tx_status',
                'swap_type',
                'chain_id',
                'from_token_symbol',
                'to_token_symbol',
                'revert_reason',
                'created_at',
            ]);

        $hasMore = $rows->count() > $safeLimit;
        $transactions = $rows->take($safeLimit)->values()->map(fn (Transaction $transaction) => $transaction->toArray())->all();

        return [
            'transactions' => $transactions,
            'hasMore' => $hasMore,
            'offset' => $safeOffset,
            'limit' => $safeLimit,
        ];
    }
}
