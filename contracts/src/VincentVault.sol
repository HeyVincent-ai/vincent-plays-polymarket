// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
 */
contract VincentVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

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
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address manager_,
        address accountant_
    ) ERC20(name_, symbol_) ERC4626(asset_) Ownable(msg.sender) {
        require(manager_ != address(0), "VVault: manager zero");
        require(accountant_ != address(0), "VVault: accountant zero");
        manager = manager_;
        accountant = accountant_;
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
