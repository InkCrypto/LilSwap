<?php

namespace App\Http\Controllers;

use App\Services\EngineProxyClient;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ApiController extends Controller
{
    public function __construct(
        protected EngineProxyClient $engineProxyClient,
    ) {
    }

    /**
     * Proxy requests to the external API with HMAC signing.
     */
    public function proxy(Request $request, $path)
    {
        $requestId = (string) ($request->attributes->get('request_id') ?? 'unknown');

        // Simple Origin/Referer check to discourage direct API usage by 3rd parties
        $appUrl = config('app.url');
        $allowedHosts = array_filter(explode(',', (string) env('APP_ALLOWED_ORIGINS', '')));

        $appHost = parse_url((string) $appUrl, PHP_URL_HOST);
        if ($appHost) {
            $allowedHosts[] = $appHost;
        }

        $origin = $request->header('Origin');
        $referer = $request->header('Referer');

        $originHost = $origin ? parse_url((string) $origin, PHP_URL_HOST) : null;
        $refererHost = $referer ? parse_url((string) $referer, PHP_URL_HOST) : null;

        $isAuthorized = false;
        foreach ($allowedHosts as $host) {
            $host = trim((string) $host);
            if (empty($host)) continue;

            if (($originHost && $originHost === $host) ||
                ($refererHost && $refererHost === $host)
            ) {
                $isAuthorized = true;
                break;
            }
        }

        if (!$isAuthorized) {
            return response()->json([
                'error' => 'Unordered or external request',
                'reason_code' => 'APP_PROXY_ORIGIN_REJECTED',
            ], 403);
        }

        $method = $request->method();

        // Preparation for signing (matches exact string sent by client)
        $bodyString = $request->getContent();
        if (empty($bodyString) || $bodyString === '{}') {
            $bodyString = '';
        }

        try {
            $response = $this->engineProxyClient->send($method, $path, $request->all(), [
                'bodyString' => $bodyString,
                'requestId' => $requestId,
                'sessionId' => $request->session()->getId(),
            ]);

            $jsonResponse = response()->json($response->json(), $response->status());

            if ($response->hasHeader('X-Api-Version')) {
                $jsonResponse->header('X-Api-Version', $response->header('X-Api-Version'));
            } elseif ($response->hasHeader('x-api-version')) {
                $jsonResponse->header('X-Api-Version', $response->header('x-api-version'));
            }

            if ($response->hasHeader('X-Request-Id')) {
                $jsonResponse->header('X-Request-Id', $response->header('X-Request-Id'));
            }

            return $jsonResponse;
        } catch (\Exception $e) {
            Log::error("API Proxy Error: " . $e->getMessage(), [
                'path' => $path,
                'request_id' => $requestId,
                'exception' => $e
            ]);

            return response()->json([
                'error' => 'Internal Server Error during API proxying',
                'reason_code' => 'APP_PROXY_FORWARD_ERROR',
                'message' => $e->getMessage(),
            ], 500);
        }
    }
}
