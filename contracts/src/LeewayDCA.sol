// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

/// @title LeewayDCA
/// @notice Non-custodial dollar-cost averaging into shielded ZEC.
///         Users approve a stablecoin to this contract and register a plan.
///         On schedule, the Leeway keeper calls `execute`, which pulls exactly
///         one period's amount straight from the user's wallet to a fresh
///         NEAR Intents 1Click deposit address. 1Click then delivers ZEC to the
///         user's shielded Zcash address (stored off-chain against `planId`).
///
///         The contract never holds user funds. It enforces the amount and the
///         schedule, so the keeper can only trigger what the user agreed to.
contract LeewayDCA {
    struct Plan {
        address owner;
        address token;
        uint128 amountPerPeriod;
        uint32 interval; // seconds between runs
        uint32 periodsTotal; // 0 = open-ended
        uint32 periodsDone;
        uint64 nextRunAt;
        bool active;
        bytes32 zecRecipientHash; // keccak256 of the user's Zcash address; the address itself never goes on-chain
    }

    uint32 public constant MIN_INTERVAL = 1 hours;

    address public admin;
    address public keeper;
    bool public paused;
    uint256 public nextPlanId = 1;

    mapping(address => bool) public allowedToken;
    mapping(uint256 => Plan) public plans;

    event PlanCreated(
        uint256 indexed planId,
        address indexed owner,
        address token,
        uint256 amountPerPeriod,
        uint32 interval,
        uint32 periodsTotal,
        bytes32 zecRecipientHash
    );
    event PlanCancelled(uint256 indexed planId);
    event Executed(uint256 indexed planId, uint32 period, address depositAddress, uint256 amount);
    event KeeperChanged(address keeper);
    event AdminChanged(address admin);
    event TokenAllowed(address token, bool allowed);
    event Paused(bool paused);

    error NotAdmin();
    error NotKeeper();
    error NotOwner();
    error IsPaused();
    error TokenNotAllowed();
    error BadParams();
    error PlanInactive();
    error NotDue();
    error TransferFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    constructor(address _keeper, address[] memory tokens) {
        admin = msg.sender;
        keeper = _keeper;
        for (uint256 i = 0; i < tokens.length; i++) {
            allowedToken[tokens[i]] = true;
            emit TokenAllowed(tokens[i], true);
        }
    }

    // ---------------------------------------------------------------- users

    /// @notice Register a DCA plan. The first run is due immediately.
    function createPlan(
        address token,
        uint128 amountPerPeriod,
        uint32 interval,
        uint32 periodsTotal,
        bytes32 zecRecipientHash
    ) external returns (uint256 planId) {
        if (paused) revert IsPaused();
        if (!allowedToken[token]) revert TokenNotAllowed();
        if (amountPerPeriod == 0 || interval < MIN_INTERVAL || zecRecipientHash == bytes32(0)) revert BadParams();

        planId = nextPlanId++;
        plans[planId] = Plan({
            owner: msg.sender,
            token: token,
            amountPerPeriod: amountPerPeriod,
            interval: interval,
            periodsTotal: periodsTotal,
            periodsDone: 0,
            nextRunAt: uint64(block.timestamp),
            active: true,
            zecRecipientHash: zecRecipientHash
        });

        emit PlanCreated(planId, msg.sender, token, amountPerPeriod, interval, periodsTotal, zecRecipientHash);
    }

    /// @notice Stop a plan. Revoking the token allowance also stops it.
    function cancelPlan(uint256 planId) external {
        Plan storage p = plans[planId];
        if (p.owner != msg.sender) revert NotOwner();
        if (!p.active) revert PlanInactive();
        p.active = false;
        emit PlanCancelled(planId);
    }

    // --------------------------------------------------------------- keeper

    /// @notice Pull one period's amount from the plan owner to a 1Click deposit address.
    /// @dev The keeper obtains `depositAddress` from a 1Click quote whose recipient is the
    ///      user's shielded Zcash address. Exposure is bounded to one period per interval.
    function execute(uint256 planId, address depositAddress) external onlyKeeper {
        if (paused) revert IsPaused();
        Plan storage p = plans[planId];
        if (!p.active) revert PlanInactive();
        if (block.timestamp < p.nextRunAt) revert NotDue();
        if (depositAddress == address(0)) revert BadParams();

        p.periodsDone += 1;
        // Schedule from the planned time, not from now, so a late run doesn't drift the calendar,
        // but never schedule into the past (a long outage shouldn't allow back-to-back runs).
        uint64 planned = p.nextRunAt + p.interval;
        p.nextRunAt = planned > block.timestamp ? planned : uint64(block.timestamp) + p.interval;
        if (p.periodsTotal != 0 && p.periodsDone >= p.periodsTotal) {
            p.active = false;
        }

        _safeTransferFrom(p.token, p.owner, depositAddress, p.amountPerPeriod);
        emit Executed(planId, p.periodsDone, depositAddress, p.amountPerPeriod);
    }

    /// @notice Whether a plan can run now (active, due, and funded).
    function isRunnable(uint256 planId) external view returns (bool) {
        Plan storage p = plans[planId];
        if (!p.active || paused || block.timestamp < p.nextRunAt) return false;
        IERC20 t = IERC20(p.token);
        return t.allowance(p.owner, address(this)) >= p.amountPerPeriod && t.balanceOf(p.owner) >= p.amountPerPeriod;
    }

    // ---------------------------------------------------------------- admin

    function setKeeper(address _keeper) external onlyAdmin {
        keeper = _keeper;
        emit KeeperChanged(_keeper);
    }

    function setAdmin(address _admin) external onlyAdmin {
        if (_admin == address(0)) revert BadParams();
        admin = _admin;
        emit AdminChanged(_admin);
    }

    function setTokenAllowed(address token, bool allowed) external onlyAdmin {
        allowedToken[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        emit Paused(_paused);
    }

    // ------------------------------------------------------------- internal

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
