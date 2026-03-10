// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {VincentVault} from "../src/VincentVault.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VincentVaultTest is Test {
    address private constant USDC_E_POLYGON = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    uint256 private constant POLYGON_CHAIN_ID = 137;

    MockERC20 private asset;
    VincentVault private vault;

    address private owner = address(0x1111);
    address private manager = address(0x2222);
    address private accountant = address(0x3333);
    address private alice = address(0x4444);

    function setUp() public {
        vm.chainId(POLYGON_CHAIN_ID);
        MockERC20 implementation = new MockERC20();
        vm.etch(USDC_E_POLYGON, address(implementation).code);
        asset = MockERC20(USDC_E_POLYGON);
        vm.prank(owner);
        vault = new VincentVault("Vincent Vault", "vVAULT", manager, accountant);
    }

    function testDepositUpdatesReportedAssets() public {
        asset.mint(alice, 100e6);
        vm.startPrank(alice);
        asset.approve(address(vault), 100e6);
        vault.deposit(100e6, alice);
        vm.stopPrank();

        assertEq(vault.totalAssets(), 100e6);
        assertEq(vault.balanceOf(alice), 100e6);
    }

    function testPullToManagerLimitsWithdraw() public {
        asset.mint(alice, 100e6);
        vm.startPrank(alice);
        asset.approve(address(vault), 100e6);
        vault.deposit(100e6, alice);
        vm.stopPrank();

        vm.prank(manager);
        vault.pullToManager(60e6, manager);

        assertEq(vault.availableAssets(), 40e6);
        assertEq(vault.maxWithdraw(alice), 40e6);
    }

    function testReportAssetsRequiresSolvent() public {
        asset.mint(address(vault), 10e6);
        vm.prank(accountant);
        vm.expectRevert("VVault: insolvent report");
        vault.reportAssets(5e6);
    }

    function testConstructorRevertsOnUnsupportedChain() public {
        vm.chainId(1);
        vm.expectRevert("VVault: wrong chain");
        new VincentVault("Vincent Vault", "vVAULT", manager, accountant);
    }
}
