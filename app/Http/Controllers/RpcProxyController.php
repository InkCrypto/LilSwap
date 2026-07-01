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
                'error' => 'Unauthorized or external request',
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
        $allowedHosts = [
            ...config('app.allowed_origins', []),
            ...config('miniapp.all_hosts', []),
        ];

        $appHost = parse_url((string) config('app.url'), PHP_URL_HOST);
        if ($appHost) {
            $allowedHosts[] = $appHost;
        }

        $allowedHosts = array_values(array_unique(array_map(
            static fn($host) => strtolower(trim((string) $host)),
            array_filter($allowedHosts),
        )));

        $originHost = $request->header('Origin')
            ? strtolower((string) parse_url((string) $request->header('Origin'), PHP_URL_HOST))
            : null;
        $refererHost = $request->header('Referer')
            ? strtolower((string) parse_url((string) $request->header('Referer'), PHP_URL_HOST))
            : null;

        if (($originHost && in_array($originHost, $allowedHosts, true))
            || ($refererHost && in_array($refererHost, $allowedHosts, true))) {
            return true;
        }

        return config('app.env') === 'local' && !$originHost && !$refererHost;
    }
}
