<?php

namespace Tests\Feature;

use App\Http\Middleware\HandleInertiaRequests;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Tests\TestCase;

class InertiaCacheHeadersTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Test that Inertia responses correctly set Cache-Control headers to prevent browser caching.
     */
    public function test_inertia_responses_prevent_caching(): void
    {
        $version = app(HandleInertiaRequests::class)->version(new Request());

        $response = $this->get(route('home'), [
            'X-Inertia' => 'true',
            'X-Inertia-Version' => $version,
        ]);

        $response->assertHeader('X-Inertia');
        $response->assertHeader('Cache-Control', 'max-age=0, must-revalidate, no-cache, no-store, private');
        $response->assertHeader('Pragma', 'no-cache');
        $response->assertHeader('Expires', 'Fri, 01 Jan 1990 00:00:00 GMT');
    }
}
