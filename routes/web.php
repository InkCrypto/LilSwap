<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\HomeController;
use App\Http\Controllers\LogController;
use App\Http\Controllers\TransactionController;

Route::get('/', [HomeController::class, 'index'])->name('home');
Route::get('/spot', [HomeController::class, 'swap'])->name('spot');
Route::get('/aave', [HomeController::class, 'index'])->name('aave');

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

// Spot Swap Proxy Route
Route::match(['get', 'post', 'put', 'delete'], '/spot/{path}', function (\Illuminate\Http\Request $request, $path) {
    return app(\App\Http\Controllers\ApiController::class)->proxy($request, "spot/$path");
})->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth'])->where('path', '.*');

// Transactions API Proxy Route
Route::match(['get', 'post', 'put', 'delete'], '/transactions/{path}', function (\Illuminate\Http\Request $request, $path) {
    return app(\App\Http\Controllers\ApiController::class)->proxy($request, "transactions/$path");
})->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth'])->where('path', '.*');

Route::match(['get', 'post', 'put', 'delete'], '/limit-orders/{path?}', function (\Illuminate\Http\Request $request, $path = '') {
    return app(\App\Http\Controllers\ApiController::class)->proxy($request, trim("limit-orders/$path", '/'));
})->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth'])->where('path', '.*');

Route::match(['get', 'post', 'put', 'delete'], '/donations/{path}', function (\Illuminate\Http\Request $request, $path) {
    return app(\App\Http\Controllers\ApiController::class)->proxy($request, "donations/$path");
})->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth'])->where('path', '.*');

// RPC Gateway Proxy Route (Rate Limited)
Route::post('/rpc/{network}', [\App\Http\Controllers\RpcProxyController::class, 'proxy'])
    ->middleware(['throttle:rpc', 'soft.abuse', 'proxy.auth']);
