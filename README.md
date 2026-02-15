# LilSwap

LilSwap is a high-performance interface built for managing Aave V3 positions. It enables users to optimize their debt and collateral through seamless swaps, gasless signatures, and multi-chain liquidity aggregation.

## Key Features

- **Advanced Debt Shifting:** Convert debt positions between different assets within Aave V3 using ParaSwap's repay adapters.
- **Gasless Permissions:** Native support for EIP-712 Credit Delegation and Permit signatures.
- **Multi-Chain Readiness:** Designed to support Base, Ethereum Mainnet, Polygon, and BNB Chain.
- **Optimized Execution:** Real-time quote engine and smart routing to ensure minimal slippage and efficient health factor management.

## Project Roadmap

- **Phase 1: Protocol Foundations & Multi-Chain Expansion**
  - Infrastructure setup for core debt-shifting logic.
  - Multi-chain integration (Base, Ethereum, Polygon, and BNB).
  - Dynamic token discovery via Aave Address Book.

- **Phase 2: Enhanced Asset Management**
  - Implementation of on-chain Collateral Swapping.
  - Integration with liquidity adapters for seamless collateral migration.
  - UI refinement for position tracking and health factor simulation.

- **Phase 3: High-Efficiency Trading**
  - Support for off-chain/gasless trade execution.
  - Integration with CoW Protocol for MEV protection.
  - Advanced risk management features and automated safety buffers.

## Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS 4, Wagmi.
- **Backend (Engine):** Node.js, Express, Ethers.js v6.
- **Integration:** Aave V3, ParaSwap API, CoW SDK.

## Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/InkCrypto/LilSwap.git
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Configure Environment:**
   Copy `.env.example` to `.env` and fill in your RPC URLs and API keys.
   Recommendation: keep only `.env.example` in the repo. Each developer creates their own `.env.local` for local overrides.

## Local & CI environment setup (short)


- Local development: copy `.env.example` to `.env.local` in the project root (this file is gitignored) and edit values. Example:

   ```bash
   cp .env.example .env.local
   # Edit .env.local to point to the API you want to use for development.
   # For a local engine: http://localhost:3001
   # For testing against production API: https://engine.PROD_DOMAIN/api/v1
   # Example: VITE_API_URL=https://engine.PROD_DOMAIN/api/v1
   ```

- By default contributors should point to the official production API unless they explicitly run a local engine.

- CI / Production: set `VITE_API_URL` in your CI/build environment so production builds embed the official API URL. Do not store production secrets in the repo.
4. **Run Development Mode:**
   ```bash
   npm run dev
   ```

*Disclaimer: LilSwap is a specialized interface for Aave V3. Interacting with DeFi protocols involves financial risk.*