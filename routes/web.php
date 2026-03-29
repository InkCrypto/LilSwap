<?php

use Illuminate\Support\Facades\Route;

Route::inertia('/', 'welcome')->name('home');

Route::post('/session/bootstrap', [\App\Http\Controllers\ProxySessionController::class, 'bootstrap'])
    ->middleware(['throttle:rpc']);

Route::post('/session/disconnect', [\App\Http\Controllers\ProxySessionController::class, 'disconnect'])
    ->middleware(['throttle:rpc']);

// API Proxy Route (Rate Limited)
Route::match(['get', 'post', 'put', 'delete'], '/aave/{path}', function (\Illuminate\Http\Request $request, $path) {
    return app(\App\Http\Controllers\ApiController::class)->proxy($request, "aave/$path");
})->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth'])->where('path', '.*');

// Transactions API Proxy Route
Route::match(['get', 'post', 'put', 'delete'], '/transactions/{path}', function (\Illuminate\Http\Request $request, $path) {
    return app(\App\Http\Controllers\ApiController::class)->proxy($request, "transactions/$path");
})->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth'])->where('path', '.*');

// Legacy API Proxy Route (Keeping for compatibility during migration if needed)
Route::match(['get', 'post', 'put', 'delete'], '/api/{path}', [\App\Http\Controllers\ApiController::class, 'proxy'])
    ->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth'])
    ->where('path', '.*');

// Alchemy RPC Proxy Route (Rate Limited)
Route::post('/rpc/{slug}', [\App\Http\Controllers\AlchemyProxyController::class, 'proxy'])
    ->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth']);
