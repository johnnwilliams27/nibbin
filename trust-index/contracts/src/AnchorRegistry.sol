// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MerkleLib} from "./MerkleLib.sol";

/// @title AnchorRegistry
/// @notice Append-only daily anchor of the Agent Trust Index scores dump (SPEC 20.1).
/// @dev Single owner-gated writer, two-step ownership transfer, no upgradeability, holds no
/// funds. See MerkleLib for the sorted-pair hashing convention verifyInclusion relies on.
contract AnchorRegistry {
    struct Anchor {
        bytes32 root;
        bytes32 dumpHash;
        string dumpURI;
        string methodologyVersion;
        uint64 blockNumber;
        uint64 timestamp;
    }

    address public owner;
    address public pendingOwner;
    Anchor[] private _anchors;

    event AnchorPosted(
        uint256 indexed anchorIndex,
        bytes32 indexed root,
        bytes32 dumpHash,
        string dumpURI,
        string methodologyVersion,
        uint64 blockNumber,
        uint64 timestamp
    );
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
    }

    /// @notice Records one daily anchor. No update or delete path exists: this is the only
    /// writer, and it only ever pushes.
    function anchor(bytes32 root, string calldata dumpURI, bytes32 dumpHash, string calldata methodologyVersion)
        external
        onlyOwner
        returns (uint256 anchorIndex)
    {
        anchorIndex = _anchors.length;
        _anchors.push(Anchor(root, dumpHash, dumpURI, methodologyVersion, uint64(block.number), uint64(block.timestamp)));
        emit AnchorPosted(anchorIndex, root, dumpHash, dumpURI, methodologyVersion, uint64(block.number), uint64(block.timestamp));
    }

    function anchorCount() external view returns (uint256) {
        return _anchors.length;
    }

    function getAnchor(uint256 anchorIndex) external view returns (Anchor memory) {
        return _anchors[anchorIndex];
    }

    /// @notice Verifies that `leaf` is included in the root anchored at `anchorIndex`.
    /// @dev See MerkleLib for the exact pair-ordering convention `proof` must follow.
    function verifyInclusion(uint256 anchorIndex, bytes32 leaf, bytes32[] calldata proof) external view returns (bool) {
        return MerkleLib.verify(_anchors[anchorIndex].root, leaf, proof);
    }

    /// @notice Step 1 of 2: nominate a new owner. Current owner keeps full rights until step 2.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2 of 2: the nominated owner claims the role. Reverts for anyone else, which
    /// guards against a transfer to an address that cannot act (typo, unreachable contract).
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
