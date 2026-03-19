# LilSwap App

LilSwap App is the official LilSwap interface for managing and optimizing Aave V3 positions.

Website: https://lilswap.xyz
Live application: https://app.lilswap.xyz

## Who This Project Is For

- DeFi users who actively manage collateral and debt on Aave V3.
- Advanced users who need efficient multi-chain position management.
- Developers and integrators who want to run, extend, or contribute to the LilSwap project.

## What LilSwap Does

LilSwap helps users optimize risk and capital efficiency by enabling streamlined position management across supported networks.

Core capabilities:

- Debt Swap between borrowed assets in Aave V3.
- Collateral Swap between supplied assets in Aave V3.
- Gasless flows for supported permit and delegation paths.
- Multi-chain operation with unified UX.
- Partner and donor discount flow.
- Responsive dashboard for real-time position visibility.

## Supported Networks

- Ethereum Mainnet
- Base
- BNB Chain
- Polygon
- Arbitrum One
- Avalanche

## Tech Stack

- Laravel 12 (web app and API proxy layer)
- React 19 + TypeScript
- Tailwind CSS 4
- Ethers.js and Reown AppKit

## API Access Policy

LilSwap App depends on a robust, production-grade proprietary API hosted at https://api.lilswap.xyz.

To protect platform integrity, user safety, and service reliability, API access is restricted and requires authentication. This policy is in place due to repeated abuse and unauthorized consumption by malicious or bad-faith projects.

If your team has a legitimate integration need and wants to request API access, contact:

- contact@lilswap.xyz

All API key requests are subject to review, approval criteria, and usage policy enforcement.

## Local Development

### Prerequisites

- PHP 8.2+
- Composer
- Node.js 20+
- pnpm

### 1) Install dependencies

Windows PowerShell:

```powershell
composer install
pnpm install
```

macOS/Linux:

```bash
composer install
pnpm install
```

### 2) Configure environment

Windows PowerShell:

```powershell
copy .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Then run:

```bash
php artisan key:generate
php artisan migrate
```

### 3) Run the app

```bash
composer dev
```

This starts the Laravel server, queue worker, and Vite dev server together.

## Frontend Quality Checks

```bash
pnpm run lint:check
pnpm run types:check
pnpm run build
```

## Fair and Honest Use

If you use this codebase, please do so in a way that respects both the open-source license and project identity.

- Keep required attribution intact.
- Do not remove or misrepresent original authorship.
- Do not reuse LilSwap branding in forks or redistributions without explicit written permission.
- If your use case is proprietary, use an appropriate commercial agreement.

For legal details, see:

- LICENSE
- NOTICE
- TRADEMARKS.md

## Disclaimer

Using DeFi protocols involves financial risk. Use this software at your own risk and verify all transactions before signing.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)** or later.

For proprietary use cases or commercial licensing arrangements, please contact contact@lilswap.xyz.

See the [LICENSE](LICENSE) file for the full license text.
