// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/LeewayDCA.sol";

/// Deploy to Base mainnet:
///   KEEPER_ADDRESS=0x...  ADMIN_ADDRESS=0x<your multisig>  \
///   forge script script/Deploy.s.sol --rpc-url base --broadcast --verify --private-key $DEPLOYER_KEY
///
/// The deployer only deploys. Admin (pause, keeper rotation, token list) moves to ADMIN_ADDRESS,
/// which should be a multisig such as a Safe, in the same broadcast.
contract Deploy is Script {
    // Native USDC on Base
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external returns (LeewayDCA dca) {
        address keeper = vm.envAddress("KEEPER_ADDRESS");
        address admin = vm.envAddress("ADMIN_ADDRESS");
        require(keeper != address(0) && admin != address(0), "set KEEPER_ADDRESS and ADMIN_ADDRESS");
        require(keeper != admin, "keeper and admin must differ");

        address[] memory tokens = new address[](1);
        tokens[0] = BASE_USDC;

        vm.startBroadcast();
        dca = new LeewayDCA(keeper, tokens);
        dca.setAdmin(admin);
        vm.stopBroadcast();

        require(dca.admin() == admin && dca.keeper() == keeper, "post-deploy check failed");
        console2.log("LeewayDCA", address(dca));
        console2.log("admin", admin);
        console2.log("keeper", keeper);
    }
}
