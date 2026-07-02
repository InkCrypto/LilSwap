<?php

namespace App\Http\Controllers;

use App\Services\EngineProxyClient;
use App\Services\TransactionHistoryService;
use Illuminate\Http\Request;

class TransactionController extends Controller
{
    public function __construct(
        protected TransactionHistoryService $transactionHistoryService,
        protected EngineProxyClient $engineProxyClient,
    ) {}

    /**
     * Retrieve unified history (transactions + limit orders) for a wallet.
     *
     * Security: Authentication is handled via the 'proxy.auth' middleware.
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
            $history = $this->transactionHistoryService->fetch($walletAddress, $limit, $offset);

            $limitOrdersResponse = $this->engineProxyClient->send('POST', 'limit-orders', [
                'walletAddress' => $walletAddress,
                'limit' => 50,
                'offset' => 0,
            ]);

            $limitOrders = $limitOrdersResponse->successful()
                ? ($limitOrdersResponse->json()['orders'] ?? [])
                : [];

            return response()->json([
                'transactions' => $history['transactions'],
                'limitOrders' => $limitOrders,
                'hasMore' => $history['hasMore'],
                'offset' => $history['offset'],
                'lastSyncTime' => now()->getTimestamp() * 1000,
                'error' => null,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to fetch history',
                'reason_code' => 'APP_HISTORY_ERROR',
            ], 500);
        }
    }
}
