<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Mini App URL
    |--------------------------------------------------------------------------
    |
    | The base URL for the Mini App version of LilSwap (e.g. Telegram Mini App).
    | Follows the same pattern as APP_URL for the main app.
    |
    */
    'url' => env('MINI_APP_URL'),

    /*
    |--------------------------------------------------------------------------
    | Mini App Name
    |--------------------------------------------------------------------------
    |
    | The display name shown in the UI when running in Mini App mode.
    | Follows the same pattern as APP_NAME for the main app.
    |
    */
    'name' => env('MINI_APP_NAME', 'MiniApp'),

    /*
    |--------------------------------------------------------------------------
    | Mini App Host (parsed from URL)
    |--------------------------------------------------------------------------
    |
    | The hostname extracted from MINI_APP_URL for comparison with the
    | current request host. Returns null if MINI_APP_URL is not set.
    |
    */
    'host' => env('MINI_APP_URL') ? parse_url(env('MINI_APP_URL'), PHP_URL_HOST) : null,

    /*
    |--------------------------------------------------------------------------
    | Extra Mini App Hosts
    |--------------------------------------------------------------------------
    |
    | Comma-separated list of additional hostnames where the Mini App mode
    | should also be enabled. Useful for temporary testing via ngrok or
    | other tunnel services without altering MINI_APP_URL.
    |
    */
    'extra_hosts' => env('MINI_APP_EXTRA_HOSTS'),

    /*
    |--------------------------------------------------------------------------
    | All Mini App Hosts (combined)
    |--------------------------------------------------------------------------
    |
    | The complete list of hostnames where Mini App mode is active.
    | Combines the official host (parsed from MINI_APP_URL) with any
    | extra hosts defined in MINI_APP_EXTRA_HOSTS.
    |
    */
    'all_hosts' => array_values(array_filter([
        env('MINI_APP_URL') ? parse_url(env('MINI_APP_URL'), PHP_URL_HOST) : null,
        ...array_map('trim', explode(',', env('MINI_APP_EXTRA_HOSTS', ''))),
    ])),
];
