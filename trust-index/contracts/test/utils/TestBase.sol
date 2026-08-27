// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {vm} from "./Vm.sol";

/// @notice Tiny hand-rolled assertion set, the minimum these tests need. Not a general test
/// framework; a forge-picked-up test contract needs no special base, this just avoids repeating
/// `require(a == b, "...")` at every call site. See Vm.sol for why there is no forge-std import.
abstract contract TestBase {
    function assertEq(uint256 a, uint256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(int256 a, int256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(address a, address b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(bytes32 a, bytes32 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(string memory a, string memory b, string memory message) internal pure {
        require(keccak256(bytes(a)) == keccak256(bytes(b)), message);
    }

    function assertEq(bytes memory a, bytes memory b, string memory message) internal pure {
        require(keccak256(a) == keccak256(b), message);
    }

    function assertTrue(bool condition, string memory message) internal pure {
        require(condition, message);
    }

    function assertFalse(bool condition, string memory message) internal pure {
        require(!condition, message);
    }
}
