<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class SoftAbuseGuard
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->isEnabled()) {
            return $next($request);
        }

        $windowSec = max(5, (int) env('SOFT_GUARD_WINDOW_SEC', 60));
        $threshold = max(1, (int) env('SOFT_GUARD_THRESHOLD', 90));
        $maxDelayMs = max(1, (int) env('SOFT_GUARD_MAX_DELAY_MS', 800));

        $routeBucket = $this->resolveRouteBucket($request->path());
        $clientFingerprint = $this->clientFingerprint($request);
        $windowBucket = intdiv(time(), $windowSec);
        $counterKey = "soft_guard:{$routeBucket}:{$clientFingerprint}:{$windowBucket}";

        $count = (int) Cache::increment($counterKey);

        if ($count === 1) {
            Cache::put($counterKey, 1, now()->addSeconds($windowSec + 5));
        }

        $delayed = false;
        $delayMs = 0;

        if ($count > $threshold) {
            $over = $count - $threshold;
            $delayMs = min($maxDelayMs, 50 + ($over * 25));
            usleep($delayMs * 1000);
            $delayed = true;

            Log::warning('[APP_SOFT_GUARD] Applied progressive delay', [
                'request_id' => (string) ($request->attributes->get('request_id') ?? 'unknown'),
                'reason_code' => 'APP_SOFT_GUARD_DELAY',
                'route_bucket' => $routeBucket,
                'counter' => $count,
                'threshold' => $threshold,
                'delay_ms' => $delayMs,
                'ip' => $request->ip(),
            ]);
        }

        /** @var Response $response */
        $response = $next($request);

        if ($delayed) {
            $response->headers->set('X-Abuse-Guard', 'soft-delay');
            $response->headers->set('X-Abuse-Guard-Delay-Ms', (string) $delayMs);
        }

        return $response;
    }

    private function isEnabled(): bool
    {
        return filter_var(env('SOFT_GUARD_ENABLED', false), FILTER_VALIDATE_BOOL);
    }

    private function resolveRouteBucket(string $path): string
    {
        if (str_starts_with($path, 'rpc/')) {
            return 'rpc';
        }

        if (str_starts_with($path, 'api/build/')) {
            return 'api_build';
        }

        if (str_starts_with($path, 'api/quote/')) {
            return 'api_quote';
        }

        if (str_starts_with($path, 'api/position')) {
            return 'api_position';
        }

        return 'api_other';
    }

    private function clientFingerprint(Request $request): string
    {
        $ip = (string) ($request->header('CF-Connecting-IP') ?: $request->ip() ?: 'unknown-ip');
        $userAgent = (string) ($request->userAgent() ?: 'unknown-ua');
        $sessionId = $request->hasSession() ? (string) $request->session()->getId() : 'no-session';

        return hash('sha256', strtolower($ip) . '|' . $userAgent . '|' . $sessionId);
    }
}
