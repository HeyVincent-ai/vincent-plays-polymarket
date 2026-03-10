// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * VincentVault
 * - ERC-4626 receipt token vault
 * - Manager can move assets off-chain for trading
 * - Accountant reports NAV for share pricing
 * - Withdrawals are limited by on-chain liquidity
 * - Asset is hardcoded per chain (Polygon, Polygon Amoy, Base, Base Sepolia)
 */
contract VincentVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    // Polygon USDC.e (bridged USDC) token address.
    address public constant USDC_E_POLYGON = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    // Polygon Amoy testnet USDC (Circle testnet USDC).
    address public constant USDC_AMOY = 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582;
    // Base mainnet native USDC.
    address public constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    // Base Sepolia testnet USDC.
    address public constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    uint256 public constant POLYGON_CHAIN_ID = 137;
    uint256 public constant POLYGON_AMOY_CHAIN_ID = 80002;
    uint256 public constant BASE_CHAIN_ID = 8453;
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84532;

    address public manager;
    address public accountant;

    uint256 public reportedTotalAssets;
    uint256 public lastReportAt;

    event ManagerUpdated(address indexed previousManager, address indexed newManager);
    event AccountantUpdated(address indexed previousAccountant, address indexed newAccountant);
    event AssetsReported(uint256 totalAssets, uint256 timestamp);
    event ManagerPull(address indexed to, uint256 assets);

    modifier onlyManager() {
        require(msg.sender == manager, "VVault: not manager");
        _;
    }

    modifier onlyAccountant() {
        require(msg.sender == accountant, "VVault: not accountant");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address manager_,
        address accountant_
    ) ERC20(name_, symbol_) ERC4626(IERC20(_assetForChain(block.chainid))) Ownable(msg.sender) {
        require(manager_ != address(0), "VVault: manager zero");
        require(accountant_ != address(0), "VVault: accountant zero");
        manager = manager_;
        accountant = accountant_;
    }

    function _assetForChain(uint256 chainId) internal pure returns (address) {
        if (chainId == POLYGON_CHAIN_ID) return USDC_E_POLYGON;
        if (chainId == POLYGON_AMOY_CHAIN_ID) return USDC_AMOY;
        if (chainId == BASE_CHAIN_ID) return USDC_BASE;
        if (chainId == BASE_SEPOLIA_CHAIN_ID) return USDC_BASE_SEPOLIA;
        revert("VVault: wrong chain");
    }

    function setManager(address newManager) external onlyOwner {
        require(newManager != address(0), "VVault: manager zero");
        emit ManagerUpdated(manager, newManager);
        manager = newManager;
    }

    function setAccountant(address newAccountant) external onlyOwner {
        require(newAccountant != address(0), "VVault: accountant zero");
        emit AccountantUpdated(accountant, newAccountant);
        accountant = newAccountant;
    }

    function availableAssets() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /**
     * Accountant reports total assets including off-chain holdings.
     * Must be at least the on-chain balance to avoid insolvency.
     */
    function reportAssets(uint256 totalAssets_) external onlyAccountant {
        require(totalAssets_ >= availableAssets(), "VVault: insolvent report");
        reportedTotalAssets = totalAssets_;
        lastReportAt = block.timestamp;
        emit AssetsReported(totalAssets_, block.timestamp);
    }

    /**
     * Total assets are accountant-reported (includes off-chain assets).
     */
    function totalAssets() public view override returns (uint256) {
        return reportedTotalAssets;
    }

    /**
     * Withdrawals are limited by on-chain liquidity.
     */
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 byShares = super.maxWithdraw(owner);
        uint256 available = availableAssets();
        return byShares < available ? byShares : available;
    }

    /**
     * Redeems are limited by on-chain liquidity converted to shares.
     */
    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 byShares = super.maxRedeem(owner);
        uint256 availableShareValue = convertToShares(availableAssets());
        return byShares < availableShareValue ? byShares : availableShareValue;
    }

    /**
     * Move assets out to the manager for off-chain trading.
     * Does not change reported NAV. The accountant reports updated totals.
     */
    function pullToManager(uint256 assets, address to) external onlyManager {
        require(to != address(0), "VVault: to zero");
        IERC20(asset()).safeTransfer(to, assets);
        emit ManagerPull(to, assets);
    }

    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override {
        super._deposit(caller, receiver, assets, shares);
        reportedTotalAssets += assets;
    }

    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        require(reportedTotalAssets >= assets, "VVault: reported underflow");
        super._withdraw(caller, receiver, owner, assets, shares);
        reportedTotalAssets -= assets;
    }
}
