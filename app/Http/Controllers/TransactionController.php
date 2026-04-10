<?php

namespace App\Http\Controllers;

use App\Services\TransactionHistoryService;
use Illuminate\Http\Request;

class TransactionController extends Controller
{
    public function __construct(
        protected TransactionHistoryService $transactionHistoryService,
    ) {
    }

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
            return response()->json($this->transactionHistoryService->fetch($walletAddress, $limit, $offset));
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to fetch transaction history',
                'reason_code' => 'APP_TRANSACTION_HISTORY_ERROR'
            ], 500);
        }
    }
}
