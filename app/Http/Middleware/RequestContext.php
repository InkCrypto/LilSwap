<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class RequestContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $incomingRequestId = (string) $request->header('X-Request-Id', '');
        $requestId = $this->isValidRequestId($incomingRequestId)
            ? $incomingRequestId
            : (string) Str::uuid();

        $request->attributes->set('request_id', $requestId);

        /** @var Response $response */
        $response = $next($request);
        $response->headers->set('X-Request-Id', $requestId);

        return $response;
    }

    private function isValidRequestId(string $value): bool
    {
        // Keep incoming IDs bounded to prevent log/header abuse.
        return $value !== '' && preg_match('/^[A-Za-z0-9._:-]{8,128}$/', $value) === 1;
    }
}
