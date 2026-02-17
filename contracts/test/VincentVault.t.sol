// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {VincentVault} from "../src/VincentVault.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VincentVaultTest is Test {
    MockERC20 private asset;
    VincentVault private vault;

    address private owner = address(0x1111);
    address private manager = address(0x2222);
    address private accountant = address(0x3333);
    address private alice = address(0x4444);

    function setUp() public {
        asset = new MockERC20();
        vm.prank(owner);
        vault = new VincentVault(asset, "Vincent Vault", "vVAULT", manager, accountant);
    }

    function testDepositUpdatesReportedAssets() public {
        asset.mint(alice, 100e18);
        vm.startPrank(alice);
        asset.approve(address(vault), 100e18);
        vault.deposit(100e18, alice);
        vm.stopPrank();

        assertEq(vault.totalAssets(), 100e18);
        assertEq(vault.balanceOf(alice), 100e18);
    }

    function testPullToManagerLimitsWithdraw() public {
        asset.mint(alice, 100e18);
        vm.startPrank(alice);
        asset.approve(address(vault), 100e18);
        vault.deposit(100e18, alice);
        vm.stopPrank();

        vm.prank(manager);
        vault.pullToManager(60e18, manager);

        assertEq(vault.availableAssets(), 40e18);
        assertEq(vault.maxWithdraw(alice), 40e18);
    }

    function testReportAssetsRequiresSolvent() public {
        asset.mint(address(vault), 10e18);
        vm.prank(accountant);
        vm.expectRevert("VVault: insolvent report");
        vault.reportAssets(5e18);
    }
}
