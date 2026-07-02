export const ABIS = {
    POOL: [
        "function flashLoanSimple(address receiver, address token, uint256 amount, bytes calldata params, uint16 referralCode) external",
        "function flashLoan(address receiver, address[] calldata tokens, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external",
        "function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external",
        "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
        "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
        "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external",
        "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) external returns (uint256)",
        "function repayWithATokens(address asset, uint256 amount, uint256 interestRateMode) external returns (uint256)",
        "function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128)"
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
    WETH_GATEWAY: [
        "function depositETH(address pool, address onBehalfOf, uint16 referralCode) external payable",
        "function withdrawETH(address pool, uint256 amount, address to) external",
        "function borrowETH(address pool, uint256 amount, uint16 referralCode) external",
        "function repayETH(address pool, uint256 amount, address onBehalfOf) external payable"
    ],
} as const;
