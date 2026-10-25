// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/LeewayDCA.sol";

/// Deploy to Base:
///   KEEPER_ADDRESS=0x... forge script script/Deploy.s.sol --rpc-url base --broadcast --private-key $DEPLOYER_KEY
contract Deploy is Script {
    // Native USDC on Base
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        address keeper = vm.envAddress("KEEPER_ADDRESS");
        address[] memory tokens = new address[](1);
        tokens[0] = BASE_USDC;

        vm.startBroadcast();
        LeewayDCA dca = new LeewayDCA(keeper, tokens);
        vm.stopBroadcast();

        console2.log("LeewayDCA deployed at", address(dca));
    }
}
