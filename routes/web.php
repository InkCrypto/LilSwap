<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\LogController;
use App\Http\Controllers\TransactionController;

Route::inertia('/', 'welcome')->name('home');

Route::post('/session/bootstrap', [\App\Http\Controllers\ProxySessionController::class, 'bootstrap'])
    ->middleware(['throttle:rpc']);

Route::post('/session/disconnect', [\App\Http\Controllers\ProxySessionController::class, 'disconnect'])
    ->middleware(['throttle:rpc']);

// --- Hybrid Database Access Routes (Directly handled by Laravel) ---

Route::post('/logs', [LogController::class, 'store'])
    ->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth']);

Route::post('/transactions/history', [TransactionController::class, 'history'])
    ->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth']);

// --- Proxy Routes (Everything else goes to the Node.js Engine) ---

// API Proxy Route (Rate Limited)
Route::match(['get', 'post', 'put', 'delete'], '/aave/{path}', function (\Illuminate\Http\Request $request, $path) {
    return app(\App\Http\Controllers\ApiController::class)->proxy($request, "aave/$path");
})->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth'])->where('path', '.*');

// Transactions API Proxy Route
Route::match(['get', 'post', 'put', 'delete'], '/transactions/{path}', function (\Illuminate\Http\Request $request, $path) {
    return app(\App\Http\Controllers\ApiController::class)->proxy($request, "transactions/$path");
})->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth'])->where('path', '.*');

// Alchemy RPC Proxy Route (Rate Limited)
Route::post('/rpc/{slug}', [\App\Http\Controllers\AlchemyProxyController::class, 'proxy'])
    ->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth']);
