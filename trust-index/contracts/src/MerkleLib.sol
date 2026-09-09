// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title MerkleLib
/// @notice Minimal keccak256 Merkle inclusion proof verifier with sorted-pair hashing and
/// leaf/internal-node domain separation.
/// @dev Two conventions, both of which off-chain dump tooling MUST reproduce exactly or the roots
/// it computes will not verify here:
///
/// 1. Domain separation. A leaf is hashed as `keccak256(0x00 || leaf)` before it enters the tree;
///    an internal node is `keccak256(0x01 || min || max)`. Without this, a single-hash tree lets an
///    attacker present an internal node value as if it were a leaf (the classic second-preimage
///    weakness), because the verifier cannot otherwise tell a 32-byte leaf from a 32-byte internal
///    node. The two domain bytes make the two sets disjoint.
///
/// 2. Pair ordering. At every internal level the two child hashes are compared as uint256 and
///    combined in ascending order, so a proof carries only the sibling hash at each level in
///    leaf-to-root order, with no left/right flag.
///
/// An empty proof verifies only a single-leaf tree, where the root is defined as
/// `keccak256(0x00 || leaf)`; for any larger tree an empty proof cannot match the root.
library MerkleLib {
    bytes1 internal constant LEAF_DOMAIN = 0x00;
    bytes1 internal constant NODE_DOMAIN = 0x01;

    /// @notice Returns true if `leaf`, domain-hashed and combined with `proof` sibling-by-sibling,
    /// hashes to `root`.
    function verify(bytes32 root, bytes32 leaf, bytes32[] calldata proof) internal pure returns (bool) {
        bytes32 computed = keccak256(abi.encodePacked(LEAF_DOMAIN, leaf));
        for (uint256 i = 0; i < proof.length; i++) {
            computed = _hashNode(computed, proof[i]);
        }
        return computed == root;
    }

    function _hashNode(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(NODE_DOMAIN, a, b))
            : keccak256(abi.encodePacked(NODE_DOMAIN, b, a));
    }
}
