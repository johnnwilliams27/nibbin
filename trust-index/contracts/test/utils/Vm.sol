// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Hand-written subset of the forge cheatcode interface, declaring only what these
/// tests use. Track C does not depend on forge-std (GitHub dependency fetches are unreliable
/// through this environment's proxy); this file, not an import, is the dependency.
interface Vm {
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function roll(uint256 newHeight) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
}

/// @dev Same derivation forge-std uses: the precompile-style address forge routes cheatcodes to.
address constant VM_ADDRESS = address(uint160(uint256(keccak256("hevm cheat code"))));
Vm constant vm = Vm(VM_ADDRESS);
