<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" @class(['dark' => ($appearance ?? 'system') == 'dark'])>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="csrf-token" content="{{ csrf_token() }}">

        <title inertia>{{ config('app.name', 'Laravel') }}</title>
        <meta name="title" content="LilSwap | Aave V3 Position Manager" />
        <meta name="description" content="High-performance interface for Aave V3. Optimize debt and collateral via seamless swaps, gasless signatures, and multi-chain liquidity aggregation." />
        <meta name="theme-color" content="#0A0A0A" />

        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://app.lilswap.xyz/" />
        <meta property="og:title" content="LilSwap | Aave V3 Position Manager" />
        <meta property="og:description" content="Optimize Aave V3 positions with seamless debt swaps and gasless signatures across multi-chain liquidity." />
        <meta property="og:image" content="https://app.lilswap.xyz/og-image.webp" />

        <meta property="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@LilSwap_" />
        <meta name="twitter:url" content="https://app.lilswap.xyz/" />
        <meta name="twitter:title" content="LilSwap | Aave V3 Position Manager" />
        <meta name="twitter:description" content="High-performance interface for managing Aave V3 positions with gasless permissions." />
        <meta name="twitter:image" content="https://app.lilswap.xyz/og-image.webp" />
        <meta name="twitter:image:alt" content="LilSwap Interface Preview" />

        {{-- Inline script to detect system dark mode preference and apply it immediately --}}
        <script>
            (function() {
                const appearance = '{{ $appearance ?? "system" }}';

                if (appearance === 'system') {
                    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

                    if (prefersDark) {
                        document.documentElement.classList.add('dark');
                    }
                }
            })();
        </script>

        {{-- Inline style to set the HTML background color based on our theme in app.css --}}
        <style>
            html {
                background-color: oklch(1 0 0);
            }

            html.dark {
                background-color: oklch(0.145 0 0);
            }
        </style>

        <link rel="apple-touch-icon" href="/favicon.png" />
        <link rel="icon" href="/favicon.ico" sizes="any">
        <link rel="shortcut icon" href="/favicon.ico">

        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Outfit:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">

        @viteReactRefresh
        @vite(['resources/js/app.tsx'])
        @inertiaHead
    </head>
    <body class="font-sans antialiased">
        @inertia
    </body>
</html>
