// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {vm} from "./utils/Vm.sol";
import {TestBase} from "./utils/TestBase.sol";
import {MerkleTestTree} from "./utils/MerkleTestTree.sol";
import {AnchorRegistry} from "../src/AnchorRegistry.sol";

contract AnchorRegistryTest is TestBase {
    AnchorRegistry internal registry;
    address internal owner = address(0xA11CE);
    address internal stranger = address(0xB0B);

    function setUp() public {
        registry = new AnchorRegistry(owner);
    }

    // -- access control -----------------------------------------------------

    function test_OnlyOwnerCanAnchor() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.NotOwner.selector));
        registry.anchor(bytes32(uint256(1)), "ipfs://dump", bytes32(uint256(2)), "0.1.0");
    }

    function test_OwnerCanAnchor() public {
        vm.prank(owner);
        uint256 idx = registry.anchor(bytes32(uint256(1)), "ipfs://dump", bytes32(uint256(2)), "0.1.0");
        assertEq(idx, uint256(0), "first anchor should be index 0");
    }

    // -- append-only, count and getter integrity ----------------------------

    function test_AppendOnly_CountAndIndicesIncrement() public {
        vm.startPrank(owner);
        uint256 i0 = registry.anchor(bytes32(uint256(10)), "ipfs://a", bytes32(uint256(11)), "0.1.0");
        uint256 i1 = registry.anchor(bytes32(uint256(20)), "ipfs://b", bytes32(uint256(21)), "0.1.0");
        uint256 i2 = registry.anchor(bytes32(uint256(30)), "ipfs://c", bytes32(uint256(31)), "0.1.1");
        vm.stopPrank();

        assertEq(i0, uint256(0), "index 0");
        assertEq(i1, uint256(1), "index 1");
        assertEq(i2, uint256(2), "index 2");
        assertEq(registry.anchorCount(), uint256(3), "count after three anchors");
    }

    function test_GetterIntegrity_FieldsRoundTrip() public {
        vm.roll(500);
        vm.prank(owner);
        registry.anchor(bytes32(uint256(0xAAAA)), "ipfs://dump-uri", bytes32(uint256(0xBBBB)), "1.2.3");

        AnchorRegistry.Anchor memory a = registry.getAnchor(0);
        assertEq(a.root, bytes32(uint256(0xAAAA)), "root");
        assertEq(a.dumpHash, bytes32(uint256(0xBBBB)), "dumpHash");
        assertEq(a.dumpURI, "ipfs://dump-uri", "dumpURI");
        assertEq(a.methodologyVersion, "1.2.3", "methodologyVersion");
        assertEq(uint256(a.blockNumber), uint256(500), "blockNumber recorded");
        assertTrue(a.timestamp > 0, "timestamp recorded");
    }

    function test_AnchorPosted_EventContents() public {
        vm.roll(42);
        vm.expectEmit(true, true, true, true);
        emit AnchorRegistry.AnchorPosted(0, bytes32(uint256(7)), bytes32(uint256(8)), "ipfs://x", "0.1.0", 42, uint64(block.timestamp));
        vm.prank(owner);
        registry.anchor(bytes32(uint256(7)), "ipfs://x", bytes32(uint256(8)), "0.1.0");
    }

    // -- Merkle inclusion ----------------------------------------------------

    function _fourLeaves() internal pure returns (bytes32[] memory leaves) {
        leaves = new bytes32[](4);
        leaves[0] = keccak256("leaf-0");
        leaves[1] = keccak256("leaf-1");
        leaves[2] = keccak256("leaf-2");
        leaves[3] = keccak256("leaf-3");
    }

    function test_VerifyInclusion_ValidProof_ReturnsTrue() public {
        bytes32[] memory leaves = _fourLeaves();
        bytes32 root = MerkleTestTree.root(leaves);
        bytes32[] memory proof2 = MerkleTestTree.proof(leaves, 2);

        vm.prank(owner);
        uint256 idx = registry.anchor(root, "ipfs://dump", bytes32(uint256(1)), "0.1.0");

        assertTrue(registry.verifyInclusion(idx, leaves[2], proof2), "valid proof must verify");
    }

    function test_VerifyInclusion_InvalidProof_ReturnsFalse() public {
        bytes32[] memory leaves = _fourLeaves();
        bytes32 root = MerkleTestTree.root(leaves);
        bytes32[] memory proof2 = MerkleTestTree.proof(leaves, 2);
        proof2[0] = keccak256("tampered");

        vm.prank(owner);
        uint256 idx = registry.anchor(root, "ipfs://dump", bytes32(uint256(1)), "0.1.0");

        assertFalse(registry.verifyInclusion(idx, leaves[2], proof2), "tampered proof must not verify");
    }

    function test_VerifyInclusion_WrongLeaf_ReturnsFalse() public {
        bytes32[] memory leaves = _fourLeaves();
        bytes32 root = MerkleTestTree.root(leaves);
        bytes32[] memory proof2 = MerkleTestTree.proof(leaves, 2);

        vm.prank(owner);
        uint256 idx = registry.anchor(root, "ipfs://dump", bytes32(uint256(1)), "0.1.0");

        assertFalse(registry.verifyInclusion(idx, keccak256("not-a-member"), proof2), "non-member leaf must not verify");
    }

    /// @notice Second-preimage defense: an internal node value, presented as if it were a leaf with
    /// the remaining path, must not verify. Domain separation (leaf 0x00 vs node 0x01) makes the
    /// leaf and internal-node hash sets disjoint, so this classic attack fails.
    function test_VerifyInclusion_InternalNodeAsLeaf_ReturnsFalse() public {
        bytes32[] memory leaves = _fourLeaves();
        bytes32 root = MerkleTestTree.root(leaves);

        // Reconstruct the left internal node N01 = hashNode(bottom0, bottom1) and its sibling
        // N23 = hashNode(bottom2, bottom3). Under a single-hash tree, presenting N01 as a leaf with
        // [N23] as the proof would climb straight to the root. Here it must not.
        bytes32 b0 = keccak256(abi.encodePacked(bytes1(0x00), leaves[0]));
        bytes32 b1 = keccak256(abi.encodePacked(bytes1(0x00), leaves[1]));
        bytes32 b2 = keccak256(abi.encodePacked(bytes1(0x00), leaves[2]));
        bytes32 b3 = keccak256(abi.encodePacked(bytes1(0x00), leaves[3]));
        bytes32 n01 = MerkleTestTree.hashNode(b0, b1);
        bytes32 n23 = MerkleTestTree.hashNode(b2, b3);

        bytes32[] memory forged = new bytes32[](1);
        forged[0] = n23;

        vm.prank(owner);
        uint256 idx = registry.anchor(root, "ipfs://dump", bytes32(uint256(1)), "0.1.0");

        assertFalse(registry.verifyInclusion(idx, n01, forged), "an internal node must not verify as a leaf");
    }

    /// @notice An empty proof verifies only the degenerate single-leaf tree, where the root is
    /// defined as keccak256(0x00 || leaf); it must never verify a member of a larger tree.
    function test_VerifyInclusion_EmptyProof_OnlySingleLeafTree() public {
        bytes32 leaf = keccak256("solo");
        bytes32 singleRoot = keccak256(abi.encodePacked(bytes1(0x00), leaf));

        vm.startPrank(owner);
        uint256 soloIdx = registry.anchor(singleRoot, "ipfs://solo", bytes32(uint256(1)), "0.1.0");
        bytes32[] memory fourRoot = _fourLeaves();
        uint256 fourIdx = registry.anchor(MerkleTestTree.root(fourRoot), "ipfs://four", bytes32(uint256(2)), "0.1.0");
        vm.stopPrank();

        bytes32[] memory empty = new bytes32[](0);
        assertTrue(registry.verifyInclusion(soloIdx, leaf, empty), "single-leaf tree verifies with an empty proof");
        assertFalse(registry.verifyInclusion(fourIdx, fourRoot[0], empty), "a member of a larger tree must not verify with an empty proof");
    }

    // -- two-step ownership transfer -----------------------------------------

    function test_TransferOwnership_NonOwnerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.NotOwner.selector));
        registry.transferOwnership(stranger);
    }

    function test_TransferOwnership_ZeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.ZeroAddress.selector));
        registry.transferOwnership(address(0));
    }

    function test_AcceptOwnership_WrongCallerReverts() public {
        vm.prank(owner);
        registry.transferOwnership(stranger);

        vm.prank(address(0xDEAD));
        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.NotPendingOwner.selector));
        registry.acceptOwnership();
    }

    function test_TwoStepTransfer_FullPath() public {
        vm.prank(owner);
        registry.transferOwnership(stranger);
        assertEq(registry.owner(), owner, "owner unchanged until accept");
        assertEq(registry.pendingOwner(), stranger, "pendingOwner set");

        vm.prank(stranger);
        registry.acceptOwnership();
        assertEq(registry.owner(), stranger, "owner updated after accept");
        assertEq(registry.pendingOwner(), address(0), "pendingOwner cleared");

        // old owner has lost anchor rights
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AnchorRegistry.NotOwner.selector));
        registry.anchor(bytes32(uint256(1)), "ipfs://x", bytes32(uint256(2)), "0.1.0");

        // new owner has gained them
        vm.prank(stranger);
        registry.anchor(bytes32(uint256(1)), "ipfs://x", bytes32(uint256(2)), "0.1.0");
    }
}
