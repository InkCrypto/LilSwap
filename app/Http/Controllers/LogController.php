<?php

namespace App\Http\Controllers;

use App\Models\ErrorLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class LogController extends Controller
{
    /**
     * Store a frontend log entry in the database.
     * 
     * Security: Replaced HMAC with Laravel Session/CSRF + Throttling.
     * Authentication is handled via the 'proxy.auth' middleware.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'level' => 'required|string|in:error,warn,info,debug',
            'message' => 'required|string',
            'meta' => 'nullable|array',
            'stack' => 'nullable|string',
            'url' => 'nullable|string',
            'userAddress' => 'nullable|string',
        ]);

        try {
            // Extract IP for abuse tracking
            $ips = $this->getAllIps($request);
            $ipv4 = $this->findIpType($ips, 'v4');
            $ipv6 = $this->findIpType($ips, 'v6');

            // Persist to error_logs table (standardized for engine/app)
            ErrorLog::create([
                'level' => $validated['level'],
                'message' => $validated['message'],
                'meta' => $validated['meta'],
                'stack' => $validated['stack'],
                'origin' => 'frontend',
                'url' => $validated['url'],
                'wallet_address' => strtolower($validated['userAddress'] ?? ''),
                'ipv4' => $ipv4,
                'ipv6' => $ipv6,
            ]);

            return response()->json(['success' => true], 201);
        } catch (\Exception $e) {
            Log::error('[LogController] Failed to store frontend log: ' . $e->getMessage());
            
            return response()->json([
                'error' => 'Failed to store log',
                'reason_code' => 'APP_LOG_STORE_ERROR'
            ], 500);
        }
    }

    /**
     * Helper to extract IPs from request and headers
     */
    private function getAllIps(Request $request)
    {
        $forwarded = $request->header('X-Forwarded-For');
        if ($forwarded) {
            return array_map('trim', explode(',', $forwarded));
        }
        return [$request->ip()];
    }

    /**
     * Helper to find first IP of specific type
     */
    private function findIpType(array $ips, $type)
    {
        foreach ($ips as $ip) {
            if ($type === 'v4' && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
                return $ip;
            }
            if ($type === 'v6' && filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
                return $ip;
            }
        }
        return null;
    }
}
