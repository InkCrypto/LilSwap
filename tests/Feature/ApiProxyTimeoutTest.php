<?php

namespace Tests\Feature;

use App\Http\Controllers\ApiController;
use App\Services\EngineProxyClient;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\TestCase;

class ApiProxyTimeoutTest extends TestCase
{
    public function test_engine_connection_timeout_returns_safe_gateway_timeout_response(): void
    {
        $client = Mockery::mock(EngineProxyClient::class);
        $client->shouldReceive('send')
            ->once()
            ->andThrow(new ConnectionException('sensitive upstream details'));

        Log::shouldReceive('warning')
            ->once()
            ->with('Engine proxy timed out', [
                'path' => 'aave/v3/build/debt/paraswap',
                'request_id' => 'test-request-id',
            ]);

        $request = Request::create(
            '/aave/v3/build/debt/paraswap',
            'POST',
            [],
            [],
            [],
            [
                'HTTP_ORIGIN' => config('app.url'),
                'CONTENT_TYPE' => 'application/json',
            ],
            '{"chainId":1}',
        );
        $request->attributes->set('request_id', 'test-request-id');
        $request->setLaravelSession(app('session')->driver());

        $response = (new ApiController($client))->proxy($request, 'aave/v3/build/debt/paraswap');
        $payload = json_decode($response->getContent(), true);

        $this->assertSame(504, $response->getStatusCode());
        $this->assertSame('APP_PROXY_TIMEOUT', $payload['reason_code']);
        $this->assertArrayNotHasKey('message', $payload);
        $this->assertStringNotContainsString('sensitive upstream details', $response->getContent());
    }
}
