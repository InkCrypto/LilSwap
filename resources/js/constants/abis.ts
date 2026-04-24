export const ABIS = {
    POOL: [
        "function flashLoanSimple(address receiver, address token, uint256 amount, bytes calldata params, uint16 referralCode) external",
        "function flashLoan(address receiver, address[] calldata tokens, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external",
        "function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external"
    ],
    POOL_GETTER: [
        "function getReserveData(address asset) external view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, uint40 liquidationGracePeriodUntil, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))"
    ],
    DATA_PROVIDER: [
        "function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)"
    ],
    ERC20: [
        "function name() external view returns (string)",
        "function symbol() external view returns (string)",
        "function balanceOf(address account) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function nonces(address owner) external view returns (uint256)",
        "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external"
    ],
    DEBT_TOKEN: [
        "function approveDelegation(address delegatee, uint256 amount) external",
        "function borrowAllowance(address fromUser, address toUser) external view returns (uint256)",
        "function balanceOf(address user) external view returns (uint256)",
        "function nonces(address owner) external view returns (uint256)",
        "function name() external view returns (string)"
    ],
    ADAPTER: [
        {
            "inputs": [
                {
                    "components": [
                        { "internalType": "address", "name": "debtAsset", "type": "address" },
                        { "internalType": "uint256", "name": "debtRepayAmount", "type": "uint256" },
                        { "internalType": "uint256", "name": "debtRateMode", "type": "uint256" },
                        { "internalType": "address", "name": "newDebtAsset", "type": "address" },
                        { "internalType": "uint256", "name": "maxNewDebtAmount", "type": "uint256" },
                        { "internalType": "address", "name": "extraCollateralAsset", "type": "address" },
                        { "internalType": "uint256", "name": "extraCollateralAmount", "type": "uint256" },
                        { "internalType": "uint256", "name": "offset", "type": "uint256" },
                        { "internalType": "bytes", "name": "paraswapData", "type": "bytes" }
                    ],
                    "internalType": "struct IParaSwapDebtSwapAdapter.DebtSwapParams",
                    "name": "params",
                    "type": "tuple"
                },
                {
                    "components": [
                        { "internalType": "address", "name": "debtToken", "type": "address" },
                        { "internalType": "uint256", "name": "value", "type": "uint256" },
                        { "internalType": "uint256", "name": "deadline", "type": "uint256" },
                        { "internalType": "uint8", "name": "v", "type": "uint8" },
                        { "internalType": "bytes32", "name": "r", "type": "bytes32" },
                        { "internalType": "bytes32", "name": "s", "type": "bytes32" }
                    ],
                    "internalType": "struct IPermit.CreditPermit",
                    "name": "creditPermit",
                    "type": "tuple"
                },
                {
                    "components": [
                        { "internalType": "address", "name": "aToken", "type": "address" },
                        { "internalType": "uint256", "name": "value", "type": "uint256" },
                        { "internalType": "uint256", "name": "deadline", "type": "uint256" },
                        { "internalType": "uint8", "name": "v", "type": "uint8" },
                        { "internalType": "bytes32", "name": "r", "type": "bytes32" },
                        { "internalType": "bytes32", "name": "s", "type": "bytes32" }
                    ],
                    "internalType": "struct IPermit.CollateralPermit",
                    "name": "collateralPermit",
                    "type": "tuple"
                }
            ],
            "name": "swapDebt",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "inputs": [
                { "internalType": "address", "name": "asset", "type": "address" },
                { "internalType": "uint256", "name": "amount", "type": "uint256" },
                { "internalType": "uint256", "name": "premium", "type": "uint256" },
                { "internalType": "address", "name": "initiator", "type": "address" },
                { "internalType": "bytes", "name": "params", "type": "bytes" }
            ],
            "name": "executeOperation",
            "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "inputs": [],
            "name": "FLASHLOAN_PREMIUM_TOTAL",
            "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
            "stateMutability": "view",
            "type": "function"
        },
        {
            "inputs": [],
            "name": "POOL",
            "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
            "stateMutability": "view",
            "type": "function"
        }
    ]
};
