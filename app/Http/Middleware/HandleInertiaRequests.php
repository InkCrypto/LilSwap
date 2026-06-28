<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Inertia\Middleware;
use Symfony\Component\HttpFoundation\Response;

class HandleInertiaRequests extends Middleware
{
    /**
     * Handle the incoming request and configure cache headers for Inertia responses.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = parent::handle($request, $next);

        if ($response->headers->has('X-Inertia')) {
            $response->headers->set('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
            $response->headers->set('Pragma', 'no-cache');
            $response->headers->set('Expires', 'Fri, 01 Jan 1990 00:00:00 GMT');
        }

        return $response;
    }
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'name' => config('app.name'),
            'auth' => [
                'user' => $request->user(),
            ],
            'sidebarOpen' => ! $request->hasCookie('sidebar_state') || $request->cookie('sidebar_state') === 'true',
            'apiMeta' => fn () => $this->resolveApiMeta(),
        ];
    }

    /**
     * Resolve engine metadata for first paint and cache it briefly to avoid
     * adding a blocking upstream call to every Inertia response.
     *
     * @return array{version: string|null, isUp: bool}
     */
    protected function resolveApiMeta(): array
    {
        return Cache::remember('engine_api_meta', now()->addSeconds(15), function (): array {
            $apiUrl = rtrim((string) env('API_URL', 'http://localhost:3001/v1'), '/');
            $healthUrl = preg_replace('#/v1$#', '', $apiUrl) . '/v1/health';

            try {
                $response = Http::timeout(2)->acceptJson()->get($healthUrl);

                if (! $response->successful()) {
                    return [
                        'version' => null,
                        'isUp' => false,
                    ];
                }

                return [
                    'version' => $response->json('version'),
                    'isUp' => true,
                ];
            } catch (\Throwable) {
                return [
                    'version' => null,
                    'isUp' => false,
                ];
            }
        });
    }
}
