// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Independent, test-only reimplementation of the sorted-pair Merkle tree builder that
/// off-chain dump tooling is expected to use. Deliberately does not call MerkleLib: this is here
/// to prove an independently written builder produces roots and proofs MerkleLib accepts, which
/// is the actual claim SPEC 20.1 makes ("off-chain dump tooling must reproduce it"). Power-of-two
/// leaf counts only; no odd-leaf duplication rule is defined or needed by these tests.
library MerkleTestTree {
    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory level = leaves;
        while (level.length > 1) {
            level = _levelUp(level);
        }
        return level[0];
    }

    /// @notice Sibling hash at each level from `leaves[index]` up to the root, leaf-to-root order.
    function proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory) {
        uint256 depth = 0;
        for (uint256 n = leaves.length; n > 1; n >>= 1) {
            depth++;
        }
        bytes32[] memory path = new bytes32[](depth);
        bytes32[] memory level = leaves;
        uint256 idx = index;
        for (uint256 d = 0; d < depth; d++) {
            path[d] = level[idx ^ 1];
            level = _levelUp(level);
            idx /= 2;
        }
        return path;
    }

    function _levelUp(bytes32[] memory level) private pure returns (bytes32[] memory) {
        bytes32[] memory next = new bytes32[](level.length / 2);
        for (uint256 i = 0; i < next.length; i++) {
            next[i] = _hashPair(level[2 * i], level[2 * i + 1]);
        }
        return next;
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
