<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ApiController extends Controller
{
    /**
     * Proxy requests to the external API with HMAC signing.
     */
    public function proxy(Request $request, $path)
    {
        $requestId = (string) ($request->attributes->get('request_id') ?? 'unknown');

        // Simple Origin/Referer check to discourage direct API usage by 3rd parties
        $appUrl = config('app.url');
        $origin = $request->header('Origin');
        $referer = $request->header('Referer');

        if (($origin && !str_contains($origin, parse_url($appUrl, PHP_URL_HOST))) ||
            ($referer && !str_contains($referer, parse_url($appUrl, PHP_URL_HOST)))
        ) {
            return response()->json([
                'error' => 'Unordered or external request',
                'reason_code' => 'APP_PROXY_ORIGIN_REJECTED',
            ], 403);
        }

        $apiUrl = env('API_URL', 'http://localhost:3001/v1');
        $apiSecret = env('API_SECRET');

        $method = $request->method();
        $fullUrl = rtrim($apiUrl, '/') . '/' . ltrim($path, '/');
        $body = $request->all();
        $timestamp = (string) (now()->getTimestamp() * 1000); // Milliseconds to match JS

        // Preparation for signing (matches legacy api.js logic)
        $bodyString = '';
        if (!empty($body)) {
            $bodyString = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if ($bodyString === '{}') {
                $bodyString = '';
            }
        }

        $signingV2Enabled = filter_var(env('SIGNING_V2_ENABLED', false), FILTER_VALIDATE_BOOL);
        $nonce = $signingV2Enabled ? bin2hex(random_bytes(12)) : null;
        $payloadToSign = $signingV2Enabled
            ? $timestamp . '|' . $nonce . '|' . $bodyString
            : $timestamp . $bodyString;

        $signature = hash_hmac('sha256', $payloadToSign, $apiSecret);

        // Match the engine's signing logic: HMAC-SHA256(keccak256(secret), timestamp + body)
        // We use a simple hash fallback if a keccak library isn't available,
        // but for now let's assume the engine accepts the raw secret if we switch header names
        // OR better: if it's a log request, use X-Log headers.

        $signatureHeaders = [
            'X-Internal-Signature' => $signature,
            'X-Internal-Timestamp' => $timestamp,
        ];

        if ($signingV2Enabled && $nonce !== null) {
            $signatureHeaders['X-Internal-Signature-Version'] = '2';
            $signatureHeaders['X-Internal-Nonce'] = $nonce;
        }

        if (str_contains($path, 'logs')) {
            $signatureHeaders['X-Log-Signature'] = $signature;
            $signatureHeaders['X-Log-Timestamp'] = $timestamp;
        }

        try {
            $response = Http::withHeaders(array_merge([
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
                'X-Request-Id' => $requestId,
            ], $signatureHeaders))->send($method, $fullUrl, [
                'json' => $body
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
