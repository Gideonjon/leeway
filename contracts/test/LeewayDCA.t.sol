// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/LeewayDCA.sol";

contract MockUSDC {
    string public constant name = "USD Coin";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract LeewayDCATest is Test {
    LeewayDCA dca;
    MockUSDC usdc;
    address keeper = address(0xBEEF);
    address alice = address(0xA11CE);
    address deposit1 = address(0xD1);
    address deposit2 = address(0xD2);
    bytes32 zecHash = keccak256("u1exampleshieldedaddress");

    function setUp() public {
        usdc = new MockUSDC();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        dca = new LeewayDCA(keeper, tokens);

        usdc.mint(alice, 1_000e6);
        vm.prank(alice);
        usdc.approve(address(dca), type(uint256).max);
    }

    function _plan(uint32 periods) internal returns (uint256 id) {
        vm.prank(alice);
        id = dca.createPlan(address(usdc), 50e6, 7 days, periods, zecHash);
    }

    function test_createPlan_firstRunDueImmediately() public {
        uint256 id = _plan(4);
        assertTrue(dca.isRunnable(id));
        (address owner,,,,,,,bool active,) = dca.plans(id);
        assertEq(owner, alice);
        assertTrue(active);
    }

    function test_execute_pullsExactlyOnePeriodToDeposit() public {
        uint256 id = _plan(4);
        vm.prank(keeper);
        dca.execute(id, deposit1);
        assertEq(usdc.balanceOf(deposit1), 50e6);
        assertEq(usdc.balanceOf(alice), 950e6);
        assertEq(usdc.balanceOf(address(dca)), 0, "contract never holds funds");
    }

    function test_execute_revertsWhenNotDue() public {
        uint256 id = _plan(4);
        vm.prank(keeper);
        dca.execute(id, deposit1);
        vm.prank(keeper);
        vm.expectRevert(LeewayDCA.NotDue.selector);
        dca.execute(id, deposit2);

        vm.warp(block.timestamp + 7 days);
        vm.prank(keeper);
        dca.execute(id, deposit2);
        assertEq(usdc.balanceOf(deposit2), 50e6);
    }

    function test_execute_onlyKeeper() public {
        uint256 id = _plan(4);
        vm.expectRevert(LeewayDCA.NotKeeper.selector);
        dca.execute(id, deposit1);
    }

    function test_longOutageDoesNotAllowBackToBackRuns() public {
        uint256 id = _plan(0);
        vm.prank(keeper);
        dca.execute(id, deposit1);
        vm.warp(block.timestamp + 30 days); // keeper was down for 4 periods
        vm.prank(keeper);
        dca.execute(id, deposit1);
        vm.prank(keeper);
        vm.expectRevert(LeewayDCA.NotDue.selector);
        dca.execute(id, deposit1);
    }

    function test_planEndsAfterPeriodsTotal() public {
        uint256 id = _plan(2);
        vm.prank(keeper);
        dca.execute(id, deposit1);
        vm.warp(block.timestamp + 7 days);
        vm.prank(keeper);
        dca.execute(id, deposit1);
        assertFalse(dca.isRunnable(id));
        vm.warp(block.timestamp + 7 days);
        vm.prank(keeper);
        vm.expectRevert(LeewayDCA.PlanInactive.selector);
        dca.execute(id, deposit1);
    }

    function test_ownerCanCancel_othersCannot() public {
        uint256 id = _plan(4);
        vm.expectRevert(LeewayDCA.NotOwner.selector);
        dca.cancelPlan(id);
        vm.prank(alice);
        dca.cancelPlan(id);
        vm.prank(keeper);
        vm.expectRevert(LeewayDCA.PlanInactive.selector);
        dca.execute(id, deposit1);
    }

    function test_revokedAllowanceStopsRuns() public {
        uint256 id = _plan(4);
        vm.prank(alice);
        usdc.approve(address(dca), 0);
        assertFalse(dca.isRunnable(id));
        vm.prank(keeper);
        vm.expectRevert(LeewayDCA.TransferFailed.selector);
        dca.execute(id, deposit1);
    }

    function test_rejectsBadParams() public {
        vm.startPrank(alice);
        vm.expectRevert(LeewayDCA.BadParams.selector);
        dca.createPlan(address(usdc), 0, 7 days, 4, zecHash);
        vm.expectRevert(LeewayDCA.BadParams.selector);
        dca.createPlan(address(usdc), 50e6, 10 minutes, 4, zecHash);
        vm.expectRevert(LeewayDCA.BadParams.selector);
        dca.createPlan(address(usdc), 50e6, 7 days, 4, bytes32(0));
        vm.expectRevert(LeewayDCA.TokenNotAllowed.selector);
        dca.createPlan(address(0xDEAD), 50e6, 7 days, 4, zecHash);
        vm.stopPrank();
    }

    function test_pauseBlocksCreateAndExecute() public {
        uint256 id = _plan(4);
        dca.setPaused(true);
        vm.prank(keeper);
        vm.expectRevert(LeewayDCA.IsPaused.selector);
        dca.execute(id, deposit1);
        vm.prank(alice);
        vm.expectRevert(LeewayDCA.IsPaused.selector);
        dca.createPlan(address(usdc), 50e6, 7 days, 4, zecHash);
    }

    function testFuzz_neverPullsMoreThanOnePeriodPerInterval(uint32 jump) public {
        uint256 id = _plan(0);
        vm.assume(jump < 365 days);
        vm.prank(keeper);
        dca.execute(id, deposit1);
        vm.warp(block.timestamp + jump);
        vm.prank(keeper);
        try dca.execute(id, deposit1) {} catch {}
        vm.prank(keeper);
        try dca.execute(id, deposit1) {} catch {}
        uint256 maxRuns = 2;
        assertLe(usdc.balanceOf(deposit1), maxRuns * 50e6);
    }
}
