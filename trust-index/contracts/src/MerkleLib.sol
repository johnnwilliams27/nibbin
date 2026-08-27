// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title MerkleLib
/// @notice Minimal keccak256 Merkle inclusion proof verifier, sorted-pair hashing.
/// @dev Pair-ordering convention: at every level, the two nodes being combined are compared
/// as uint256 and hashed in ascending order, `keccak256(abi.encodePacked(min, max))`. A proof
/// is therefore just the sibling hash at each level, in leaf-to-root order; no left/right flag
/// is carried, because the ascending sort makes the combine order unambiguous either way.
///
/// Off-chain dump tooling that builds the tree anchored by AnchorRegistry MUST use this exact
/// rule (ascending sort, then keccak256 of the packed 64-byte pair) at every level, including
/// the first level above the leaves, or roots it computes will not match what verifies here.
library MerkleLib {
    /// @notice Returns true if `leaf`, combined with `proof` sibling-by-sibling, hashes to `root`.
    function verify(bytes32 root, bytes32 leaf, bytes32[] calldata proof) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computed = _hashPair(computed, proof[i]);
        }
        return computed == root;
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
