<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProxySessionController extends Controller
{
    public function bootstrap(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'walletAddress' => ['nullable', 'string', 'max:128'],
            'chainId' => ['nullable', 'integer'],
        ]);

        $wallet = isset($validated['walletAddress'])
            ? strtolower(trim((string) $validated['walletAddress']))
            : null;

        $session = $request->session();
        $data = (array) $session->get('proxy_session', []);

        if (($data['active_wallet'] ?? null) !== $wallet) {
            \Log::info('[BOOTSTRAP] Wallet Changed', [
                'old' => $data['active_wallet'] ?? 'none',
                'new' => $wallet ?? 'none'
            ]);
        }

        $wallets = array_values(array_unique(array_filter((array) ($data['wallets'] ?? []), fn($v) => is_string($v) && $v !== '')));
        if ($wallet && !in_array($wallet, $wallets, true)) {
            $wallets[] = $wallet;
            $wallets = array_slice($wallets, -20);
        }

        $session->put('proxy_session', [
            'bound' => true,
            'bound_at' => $data['bound_at'] ?? time(),
            'last_seen_at' => time(),
            'wallets' => $wallets,
            'active_wallet' => $wallet ?? ($data['active_wallet'] ?? null),
            'wallet_switch_timestamps' => (array) ($data['wallet_switch_timestamps'] ?? []),
            'chain_id' => $validated['chainId'] ?? ($data['chain_id'] ?? null),
        ]);

        return response()->json([
            'ok' => true,
            'session_ttl_minutes' => (int) config('session.lifetime', 120),
        ]);
    }

    public function disconnect(Request $request): JsonResponse
    {
        $request->session()->forget('proxy_session');

        return response()->json([
            'ok' => true,
        ]);
    }
}
