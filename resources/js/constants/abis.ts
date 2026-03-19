export const ABIS = {
    POOL: [
        // Aave v3.1 ReserveData struct: uint16 id + uint40 liquidationGracePeriodUntil added before aTokenAddress
        "function getReserveData(address asset) external view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, uint40 liquidationGracePeriodUntil, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
        "function flashLoanSimple(address receiver, address token, uint256 amount, bytes calldata params, uint16 referralCode) external",
        "function flashLoan(address receiver, address[] calldata tokens, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external"
    ],
    DATA_PROVIDER: [
        "function getReserveTokensAddresses(address asset) external view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)"
    ],
    ERC20: [
        "function balanceOf(address account) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function approve(address spender, uint256 amount) external returns (bool)",
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
        "function swapDebt(tuple(address debtAsset, uint256 debtRepayAmount, uint256 debtRateMode, address newDebtAsset, uint256 maxNewDebtAmount, address extraCollateralAsset, uint256 extraCollateralAmount, uint256 offset, bytes paraswapData) params, tuple(address debtToken, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) creditPermit, tuple(address aToken, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) collateralPermit) external",
        "function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bool)",
        "function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint256)",
        "function POOL() external view returns (address)"
    ]
};
