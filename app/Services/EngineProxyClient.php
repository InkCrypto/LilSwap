<?php

namespace App\Services;

use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

class EngineProxyClient
{
    /**
     * Forward a signed JSON request to the Node engine.
     *
     * @param  array<string, mixed>  $payload
     * @param  array<string, string|null>  $options
     */
    public function send(string $method, string $path, array $payload = [], array $options = []): Response
    {
        $apiUrl = rtrim((string) env('API_URL', 'http://localhost:3001/v1'), '/');
        $apiSecret = (string) env('API_SECRET', '');
        $fullUrl = $apiUrl . '/' . ltrim($path, '/');

        $bodyString = $options['bodyString'] ?? '';
        if ($bodyString === '') {
            $bodyString = empty($payload) ? '' : json_encode($payload, JSON_UNESCAPED_SLASHES);
        }

        if ($bodyString === false || $bodyString === '{}' || $bodyString === '[]') {
            $bodyString = '';
        }

        $timestamp = (string) (now()->getTimestamp() * 1000);
        $isLogs = str_contains($path, 'logs');
        $signingV2Enabled = ! $isLogs && filter_var(env('SIGNING_V2_ENABLED', false), FILTER_VALIDATE_BOOL);
        $nonce = $signingV2Enabled ? bin2hex(random_bytes(12)) : null;
        $payloadToSign = $signingV2Enabled
            ? $timestamp . '|' . $nonce . '|' . $bodyString
            : $timestamp . $bodyString;

        $signature = hash_hmac('sha256', $payloadToSign, $apiSecret);

        $headers = array_filter([
            'Content-Type' => 'application/json',
            'Accept' => 'application/json',
            'X-Request-Id' => $options['requestId'] ?? null,
            'X-Internal-Signature' => $signature,
            'X-Internal-Timestamp' => $timestamp,
            'X-Internal-Session-ID' => $options['sessionId'] ?? null,
            'X-Internal-Signature-Version' => $signingV2Enabled ? '2' : null,
            'X-Internal-Nonce' => $nonce,
            'X-Log-Signature' => $isLogs ? $signature : null,
            'X-Log-Timestamp' => $isLogs ? $timestamp : null,
        ], static fn ($value) => $value !== null && $value !== '');

        return Http::withHeaders($headers)
            ->withBody($bodyString, 'application/json')
            ->send($method, $fullUrl);
    }
}
