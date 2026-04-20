<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AlchemyProxyController extends Controller
{
    /**
     * Proxy JSON-RPC requests to Alchemy.
     */
    public function proxy(Request $request, string $slug)
    {
        $requestId = (string) ($request->header('X-Request-Id') ?? $request->input('request_id') ?? 'unknown');

        // Origin/Referer check to discourage direct API usage by 3rd parties
        // We allow anything matching APP_URL or entries in APP_ALLOWED_ORIGINS
        $appUrl = config('app.url');
        $allowedOrigins = config('app.allowed_origins', []);
        $origin = $request->header('Origin');
        $referer = $request->header('Referer');

        $isValidOrigin = false;

        // Check against primary APP_URL
        $appHost = parse_url($appUrl, PHP_URL_HOST);
        if ($origin && str_contains($origin, $appHost)) $isValidOrigin = true;
        if ($referer && str_contains($referer, $appHost)) $isValidOrigin = true;

        // Check against allowed origins list (like ngrok)
        if (!$isValidOrigin) {
            foreach ($allowedOrigins as $allowed) {
                if ($origin && str_contains($origin, $allowed)) {
                    $isValidOrigin = true;
                    break;
                }
                if ($referer && str_contains($referer, $allowed)) {
                    $isValidOrigin = true;
                    break;
                }
            }
        }

        // Final enforcement unless in local environment WITHOUT any origin headers
        // (which happens in some direct server-to-server debug tools)
        if (!$isValidOrigin && config('app.env') !== 'local') {
            return response()->json([
                'error' => 'Unordered or external request',
                'reason_code' => 'APP_RPC_ORIGIN_REJECTED',
            ], 403);
        }

        $apiKey = config('services.alchemy.key');

        if (!$apiKey) {
            Log::error("[AlchemyProxy] ALCHEMY_API_KEY is not configured.", [
                'request_id' => $requestId,
                'slug' => $slug,
            ]);
            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code' => -32000,
                    'message' => 'Alchemy API key not configured on server',
                    'reason_code' => 'APP_RPC_SERVER_MISCONFIGURED',
                ],
                'id' => $request->input('id')
            ], 500);
        }

        $url = "https://{$slug}.g.alchemy.com/v2/{$apiKey}";

        try {
            $response = Http::withHeaders([
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
                'X-Request-Id' => $requestId,
            ])->withBody($request->getContent(), 'application/json')
                ->post($url);

            return response($response->body(), $response->status())
                ->header('Content-Type', 'application/json')
                ->header('X-Request-Id', $response->header('X-Request-Id') ?? $requestId);
        } catch (\Exception $e) {
            Log::error("[AlchemyProxy] Error proxying to Alchemy: " . $e->getMessage(), [
                'slug' => $slug,
                'request_id' => $requestId,
                'exception' => $e
            ]);

            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code' => -32603,
                    'message' => 'Internal error proxying to Alchemy',
                    'reason_code' => 'APP_RPC_PROXY_ERROR',
                ],
                'id' => $request->input('id')
            ], 500);
        }
    }
}
