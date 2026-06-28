<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'rpc_gateway' => [
        'base_url' => env('RPC_GATEWAY_BASE_URL'),
        'path_template' => env('RPC_GATEWAY_PATH_TEMPLATE', '/queries/{network}'),
        'auth_header' => env('RPC_GATEWAY_AUTH_HEADER_NAME', 'X-Nodecore-Key'),
        'auth_value' => env('RPC_GATEWAY_AUTH_HEADER_VALUE'),
        'timeout' => env('RPC_GATEWAY_TIMEOUT', 8),
        'allowed_networks' => [
            'ethereum',
            'bsc',
            'polygon',
            'base',
            'arbitrum',
            'avalanche',
            'optimism',
            'gnosis',
            'sonic',
            'unichain',
        ],
    ],

];
