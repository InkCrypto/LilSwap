<?php

namespace App\Http\Controllers;

use App\Services\EngineProxyClient;
use App\Services\TransactionHistoryService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;

class HomeController extends Controller
{
    public function __construct(
        protected EngineProxyClient $engineProxyClient,
        protected TransactionHistoryService $transactionHistoryService,
    ) {
    }

    public function index(Request $request): Response
    {
        if ($this->shouldForceRefresh($request)) {
            $request->session()->put('positions_force_refresh_until', now()->addSeconds(10)->getTimestamp());
        }

        $walletAddress = $this->resolveActiveWallet($request);
        $props = [
            'positionsWallet' => $walletAddress,
            'historyWallet' => $walletAddress,
        ];

        if (! $walletAddress) {
            return Inertia::render('welcome', $props);
        }

        $props['positionsPayload'] = Inertia::defer(
            fn () => $this->fetchPositionsPayload($request, $walletAddress),
            'positions'
        );

        if ($this->shouldLoadHistory($request)) {
            $props['historyPayload'] = Inertia::defer(
                fn () => $this->fetchHistoryPayload($request, $walletAddress),
                'history'
            );
        }

        return Inertia::render('welcome', $props);
    }

    private function resolveActiveWallet(Request $request): ?string
    {
        $sessionData = (array) $request->session()->get('proxy_session', []);
        $wallet = $sessionData['active_wallet'] ?? null;

        return is_string($wallet) && $wallet !== '' ? strtolower($wallet) : null;
    }

    /**
     * @return array{positionsByChain: array<string, mixed>|null, donator: array{isDonator: bool, discountPercent: int|float, type: string|null}, error: string|null}
     */
    private function fetchPositionsPayload(Request $request, string $walletAddress): array
    {
        try {
            $payload = [
                'walletAddress' => $walletAddress,
            ];

            if ($this->shouldForceRefresh($request)) {
                $payload['force'] = true;
            }

            $response = $this->engineProxyClient->send('POST', 'aave/v3/positions', $payload, [
                'requestId' => (string) ($request->attributes->get('request_id') ?? 'unknown'),
                'sessionId' => $request->session()->getId(),
            ]);

            if (! $response->successful()) {
                return $this->makePositionsPayloadError($this->getPublicPositionsErrorMessage($response->status()));
            }

            $data = $response->json();
            $donator = data_get($data, '_meta.donator', []);
            unset($data['_meta']);

            return [
                'positionsByChain' => is_array($data) ? $data : [],
                'donator' => [
                    'isDonator' => (bool) data_get($donator, 'isDonator', false),
                    'discountPercent' => data_get($donator, 'discountPercent', 0),
                    'type' => data_get($donator, 'type'),
                ],
                'error' => null,
            ];
        } catch (\Throwable $exception) {
            Log::warning('[HOME_POSITIONS] Failed to fetch positions payload', [
                'wallet' => $walletAddress,
                'message' => $exception->getMessage(),
            ]);

            return $this->makePositionsPayloadError($this->getPublicPositionsErrorMessage());
        }
    }

    /**
     * @return array{positionsByChain: null, donator: array{isDonator: bool, discountPercent: int|float, type: string|null}, error: string}
     */
    private function makePositionsPayloadError(string $message): array
    {
        return [
            'positionsByChain' => null,
            'donator' => [
                'isDonator' => false,
                'discountPercent' => 0,
                'type' => null,
            ],
            'error' => $message,
        ];
    }

    /**
     * @return array{transactions: array<int, array<string, mixed>>, hasMore: bool, offset: int, lastSyncTime: int|null, error: string|null}
     */
    private function fetchHistoryPayload(Request $request, string $walletAddress): array
    {
        try {
            $offset = max(0, (int) $request->header('X-History-Offset', 0));
            $limit = max(1, min((int) $request->header('X-History-Limit', 20), 100));
            $history = $this->transactionHistoryService->fetch($walletAddress, $limit, $offset);

            return [
                'transactions' => $history['transactions'],
                'hasMore' => $history['hasMore'],
                'offset' => $history['offset'],
                'lastSyncTime' => now()->getTimestamp() * 1000,
                'error' => null,
            ];
        } catch (\Throwable $exception) {
            Log::warning('[HOME_HISTORY] Failed to fetch history payload', [
                'wallet' => $walletAddress,
                'message' => $exception->getMessage(),
            ]);

            return [
                'transactions' => [],
                'hasMore' => false,
                'offset' => 0,
                'lastSyncTime' => null,
                'error' => $this->getPublicHistoryErrorMessage(),
            ];
        }
    }

    private function getPublicPositionsErrorMessage(?int $status = null): string
    {
        return match ($status) {
            401, 403 => 'Your session expired. Please reconnect your wallet.',
            408, 429, 500, 502, 503, 504 => 'Unable to load positions right now. Please try again.',
            default => 'Unable to load positions right now. Please try again.',
        };
    }

    private function getPublicHistoryErrorMessage(): string
    {
        return 'Unable to load recent activity right now. Please try again.';
    }

    private function shouldForceRefresh(Request $request): bool
    {
        if (filter_var($request->header('X-Positions-Force', false), FILTER_VALIDATE_BOOL)) {
            return true;
        }

        $expiresAt = (int) $request->session()->get('positions_force_refresh_until', 0);

        return $expiresAt > now()->getTimestamp();
    }

    private function shouldLoadHistory(Request $request): bool
    {
        return filter_var($request->header('X-History-Load', false), FILTER_VALIDATE_BOOL);
    }
}
