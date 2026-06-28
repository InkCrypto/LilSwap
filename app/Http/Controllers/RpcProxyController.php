<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class RpcProxyController extends Controller
{
    /**
     * Proxy JSON-RPC requests to the centralized RPC gateway.
     */
    public function proxy(Request $request, string $network)
    {
        $requestId = (string) ($request->header('X-Request-Id') ?? $request->input('request_id') ?? 'unknown');

        // ── Validate network ──
        $allowedNetworks = config('services.rpc_gateway.allowed_networks', []);
        if (!in_array($network, $allowedNetworks, true)) {
            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code' => -32000,
                    'message' => "Unsupported network: {$network}",
                    'reason_code' => 'APP_RPC_UNSUPPORTED_NETWORK',
                ],
                'id' => $request->input('id'),
            ], 400);
        }

        // ── Origin/Referer validation ──
        if (!$this->isValidOrigin($request)) {
            return response()->json([
                'error' => 'Unordered or external request',
                'reason_code' => 'APP_RPC_ORIGIN_REJECTED',
            ], 403);
        }

        // ── Gateway config ──
        $baseUrl = config('services.rpc_gateway.base_url');
        $pathTemplate = config('services.rpc_gateway.path_template', '/queries/{network}');
        $authHeader = config('services.rpc_gateway.auth_header', 'X-Nodecore-Key');
        $authValue = config('services.rpc_gateway.auth_value');
        $timeout = (int) config('services.rpc_gateway.timeout', 8);

        if (!$baseUrl || !$authValue) {
            Log::error('[RpcProxy] RPC gateway is not configured.', [
                'request_id' => $requestId,
                'network' => $network,
            ]);

            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code' => -32000,
                    'message' => 'RPC gateway not configured on server',
                    'reason_code' => 'APP_RPC_GATEWAY_MISCONFIGURED',
                ],
                'id' => $request->input('id'),
            ], 500);
        }

        // ── Build URL ──
        $baseUrl = rtrim($baseUrl, '/');
        $path = str_replace('{network}', $network, $pathTemplate);
        $url = $baseUrl . $path;

        // ── Forward request ──
        try {
            $response = Http::timeout($timeout)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'Accept' => 'application/json',
                    'X-Request-Id' => $requestId,
                    $authHeader => $authValue,
                ])
                ->withBody($request->getContent(), 'application/json')
                ->post($url);

            $responseHeaders = [
                'Content-Type' => 'application/json',
                'X-Request-Id' => $response->header('X-Request-Id') ?? $requestId,
            ];

            // Forward Response-Provider header if present
            if ($response->header('Response-Provider')) {
                $responseHeaders['Response-Provider'] = $response->header('Response-Provider');
            }

            return response($response->body(), $response->status(), $responseHeaders);
        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            Log::error('[RpcProxy] Gateway connection error: ' . $e->getMessage(), [
                'network' => $network,
                'request_id' => $requestId,
            ]);

            $statusCode = str_contains($e->getMessage(), 'timeout') ? 504 : 502;

            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code' => -32603,
                    'message' => 'RPC gateway unavailable',
                    'reason_code' => 'APP_RPC_GATEWAY_UNAVAILABLE',
                ],
                'id' => $request->input('id'),
            ], $statusCode);
        } catch (\Exception $e) {
            Log::error('[RpcProxy] Error proxying to RPC gateway: ' . $e->getMessage(), [
                'network' => $network,
                'request_id' => $requestId,
            ]);

            return response()->json([
                'jsonrpc' => '2.0',
                'error' => [
                    'code' => -32603,
                    'message' => 'Internal error proxying to RPC gateway',
                    'reason_code' => 'APP_RPC_GATEWAY_UNAVAILABLE',
                ],
                'id' => $request->input('id'),
            ], 502);
        }
    }

    /**
     * Validate the request origin against allowed hosts.
     */
    private function isValidOrigin(Request $request): bool
    {
        $appUrl = config('app.url');
        $allowedOrigins = config('app.allowed_origins', []);
        $origin = $request->header('Origin');
        $referer = $request->header('Referer');

        $isValid = false;

        // Check against primary APP_URL
        $appHost = parse_url($appUrl, PHP_URL_HOST);
        if ($origin && str_contains($origin, $appHost)) {
            $isValid = true;
        }
        if ($referer && str_contains($referer, $appHost)) {
            $isValid = true;
        }

        // Check against additional allowed origins
        if (!$isValid) {
            foreach ($allowedOrigins as $allowed) {
                if ($origin && str_contains($origin, $allowed)) {
                    $isValid = true;
                    break;
                }
                if ($referer && str_contains($referer, $allowed)) {
                    $isValid = true;
                    break;
                }
            }
        }

        // Allow requests without origin/referer only in local environment
        if (!$isValid && config('app.env') === 'local') {
            return true;
        }

        return $isValid;
    }
}
