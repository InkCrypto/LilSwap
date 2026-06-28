<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

/**
 * @deprecated Replaced by RpcProxyController.
 * All /rpc/{network} requests now route through RpcProxyController
 * which forwards to the centralized RPC gateway instead of Alchemy directly.
 *
 * This controller is kept only as a safety net and will be removed in a future release.
 */
class AlchemyProxyController extends Controller
{
    /**
     * @deprecated
     */
    public function proxy(Request $request, string $slug)
    {
        return response()->json([
            'error' => 'Alchemy direct proxy is deprecated. Use RpcGateway instead.',
            'reason_code' => 'APP_RPC_DEPRECATED',
        ], 410);
    }
}
