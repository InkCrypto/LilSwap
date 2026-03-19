<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class RequireProxySessionAuth
{
    /**
     * Enforce anonymous proxy session binding when enabled.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $enabled = filter_var(env('PROXY_REQUIRE_ANON_SESSION', env('PROXY_REQUIRE_SESSION_AUTH', false)), FILTER_VALIDATE_BOOL);

        if (!$enabled) {
            return $next($request);
        }

        $sessionData = (array) $request->session()->get('proxy_session', []);
        if (!(bool) ($sessionData['bound'] ?? false)) {
            return response()->json([
                'error' => 'Unauthorized',
                'reason_code' => 'APP_PROXY_SESSION_BINDING_REQUIRED',
            ], 401);
        }

        $violationResponse = $this->trackWalletSwitches($request, $sessionData);
        if ($violationResponse instanceof Response) {
            return $violationResponse;
        }

        return $next($request);
    }

    private function trackWalletSwitches(Request $request, array $sessionData): ?Response
    {
        $walletAddress = $this->extractWalletAddress($request);
        if ($walletAddress === null) {
            $sessionData['last_seen_at'] = time();
            $request->session()->put('proxy_session', $sessionData);
            return null;
        }

        $activeWallet = isset($sessionData['active_wallet']) && is_string($sessionData['active_wallet'])
            ? strtolower((string) $sessionData['active_wallet'])
            : null;

        $wallets = array_values(array_unique(array_filter((array) ($sessionData['wallets'] ?? []), fn($v) => is_string($v) && $v !== '')));
        if (!in_array($walletAddress, $wallets, true)) {
            $wallets[] = $walletAddress;
            $wallets = array_slice($wallets, -20);
        }

        $now = time();
        $windowSec = max(30, (int) env('PROXY_WALLET_SWITCH_WINDOW_SEC', 300));
        $maxSwitches = max(1, (int) env('PROXY_WALLET_SWITCH_MAX', 20));

        $switchTimestamps = array_values(array_filter(
            (array) ($sessionData['wallet_switch_timestamps'] ?? []),
            fn($ts) => is_int($ts) && ($now - $ts) <= $windowSec
        ));

        if ($activeWallet !== null && $activeWallet !== $walletAddress) {
            $switchTimestamps[] = $now;

            if (count($switchTimestamps) > $maxSwitches) {
                Log::warning('[APP_PROXY_SESSION] Wallet switch anomaly detected', [
                    'request_id' => (string) ($request->attributes->get('request_id') ?? 'unknown'),
                    'reason_code' => 'APP_PROXY_WALLET_SWITCH_ANOMALY',
                    'switches_in_window' => count($switchTimestamps),
                    'window_sec' => $windowSec,
                    'ip' => $request->ip(),
                ]);

                return response()->json([
                    'error' => 'Too Many Requests',
                    'reason_code' => 'APP_PROXY_WALLET_SWITCH_RATE_LIMIT',
                    'message' => 'Too many wallet switches in a short period.',
                ], 429);
            }
        }

        $sessionData['wallets'] = $wallets;
        $sessionData['active_wallet'] = $walletAddress;
        $sessionData['wallet_switch_timestamps'] = $switchTimestamps;
        $sessionData['last_seen_at'] = $now;

        $request->session()->put('proxy_session', $sessionData);
        return null;
    }

    private function extractWalletAddress(Request $request): ?string
    {
        $wallet = $request->input('walletAddress');
        if (!is_string($wallet)) {
            return null;
        }

        $wallet = strtolower(trim($wallet));
        return $wallet !== '' ? $wallet : null;
    }
}
