<?php

namespace App\Http\Controllers;

use App\Models\Transaction;
use Illuminate\Http\Request;

class TransactionController extends Controller
{
    /**
     * Retrieve the transaction history for a specific wallet address.
     * 
     * Security: Authentication is handled via the 'proxy.auth' middleware.
     * Logic: Queries the standardized 'transactions' table directly.
     */
    public function history(Request $request)
    {
        $validated = $request->validate([
            'walletAddress' => 'required|string|size:42',
            'limit' => 'integer|min:1|max:100',
            'offset' => 'integer|min:0',
        ]);

        $walletAddress = strtolower($validated['walletAddress']);
        $limit = $validated['limit'] ?? 20;
        $offset = $validated['offset'] ?? 0;

        try {
            $transactions = Transaction::where('wallet_address', $walletAddress)
                ->where(function ($query) {
                    $query->whereNotNull('tx_hash')
                        ->orWhere('tx_status', 'HASH_MISSING');
                })
                ->orderBy('created_at', 'desc')
                ->offset($offset)
                ->limit($limit)
                ->get([
                    'id',
                    'tx_hash',
                    'tx_status',
                    'swap_type',
                    'chain_id',
                    'from_token_symbol',
                    'to_token_symbol',
                    'revert_reason',
                    'created_at'
                ]);

            // Simplified response format (Frontend expects { transactions: [...] })
            return response()->json([
                'transactions' => $transactions,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to fetch transaction history',
                'reason_code' => 'APP_TRANSACTION_HISTORY_ERROR'
            ], 500);
        }
    }
}
