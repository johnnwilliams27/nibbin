// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title ScoreOracle
/// @notice Read-only, owner-gated-write oracle publishing Agent Trust Index scores with
/// uncertainty (SPEC 20.2). No upgradeability, holds no funds. Deploy a new instance on
/// methodology major-version bumps rather than mutating semantics under integrators.
contract ScoreOracle {
    /// @notice Mirrors `OracleAgentScore` in packages/types/src/oracle.ts field-for-field, in
    /// the same declared order. Do not reorder without updating that file and the struct-layout
    /// test in test/StructLayout.t.sol; ABI encoding is positional.
    struct AgentScore {
        int32 score; // display value * 100 (2 decimals), or NULL_SCORE_SENTINEL if null
        int32 scoreLow;
        int32 scoreHigh;
        uint16 confidence; // basis points
        uint32 nEff; // effective sample size * 100 (2 decimals)
        uint8 coverageTier; // 0 none, 1 thin, 2 moderate, 3 strong
        uint8 lifecycleState; // 0 placeholder, 1 registered, 2 live, 3 dormant
        uint32 ownershipEpoch;
        uint64 asOfBlock;
        uint32 methodologyVersion; // major*1_000_000 + minor*1_000 + patch
    }

    /// @dev Matches NULL_SCORE_SENTINEL in packages/types/src/oracle.ts.
    int32 private constant NULL_SCORE_SENTINEL = -1;

    address public owner;
    address public pendingOwner;

    mapping(uint256 => mapping(uint256 => AgentScore)) private _scores;
    mapping(uint256 => mapping(uint256 => bool)) private _hasScore;

    event ScoreSet(
        uint256 indexed chainId, uint256 indexed agentId, int32 score, uint16 confidence, uint8 coverageTier, uint64 asOfBlock
    );
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error LengthMismatch();
    error UnknownAgent();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
    }

    /// @notice Batch-writes scores. The three arrays are positional and must be equal length;
    /// a later entry for the same (chainId, agentId) pair in the same call simply overwrites an
    /// earlier one in that call, same as two separate calls would.
    function setScores(uint256[] calldata chainIds, uint256[] calldata agentIds, AgentScore[] calldata scores)
        external
        onlyOwner
    {
        uint256 n = chainIds.length;
        if (n != agentIds.length || n != scores.length) revert LengthMismatch();
        for (uint256 i = 0; i < n; i++) {
            _scores[chainIds[i]][agentIds[i]] = scores[i];
            _hasScore[chainIds[i]][agentIds[i]] = true;
            emit ScoreSet(chainIds[i], agentIds[i], scores[i].score, scores[i].confidence, scores[i].coverageTier, scores[i].asOfBlock);
        }
    }

    /// @notice True if setScores has ever written this (chainId, agentId) pair.
    function hasScore(uint256 chainId, uint256 agentId) public view returns (bool) {
        return _hasScore[chainId][agentId];
    }

    /// @notice Returns the stored score. Reverts with UnknownAgent if setScores has never
    /// written this pair, rather than returning a zero-valued struct: a zero-valued AgentScore
    /// is not distinguishable from a real (if unlikely) score on the wire, so silently returning
    /// one would be a worse failure mode than reverting. Call hasScore() first if a revert is
    /// inconvenient, or use meetsThreshold() for a fail-closed boolean that never reverts.
    function getScore(uint256 chainId, uint256 agentId) external view returns (AgentScore memory) {
        if (!_hasScore[chainId][agentId]) revert UnknownAgent();
        return _scores[chainId][agentId];
    }

    /// @notice Fails closed: false for an unknown agent, a null (sentinel) score, coverageTier
    /// == 0, or any of the three named thresholds not met. Never reverts.
    function meetsThreshold(uint256 chainId, uint256 agentId, int32 minScore, uint16 minConfidence, uint8 minCoverageTier)
        public
        view
        returns (bool)
    {
        if (!_hasScore[chainId][agentId]) return false;
        AgentScore storage s = _scores[chainId][agentId];
        if (s.score == NULL_SCORE_SENTINEL) return false;
        if (s.coverageTier == 0) return false;
        if (s.score < minScore) return false;
        if (s.confidence < minConfidence) return false;
        if (s.coverageTier < minCoverageTier) return false;
        return true;
    }

    /// @notice As meetsThreshold, additionally failing closed when the score is older than
    /// maxAgeBlocks. SPEC 20.2: staleness is not enforced by the base overload above; integrators
    /// choose their own tolerance by calling this one instead. A stored asOfBlock in the future
    /// (a write anomaly, since the owner is trusted but not infallible) is treated as maximally
    /// stale rather than underflowing.
    function meetsThreshold(
        uint256 chainId,
        uint256 agentId,
        int32 minScore,
        uint16 minConfidence,
        uint8 minCoverageTier,
        uint64 maxAgeBlocks
    ) external view returns (bool) {
        if (!meetsThreshold(chainId, agentId, minScore, minConfidence, minCoverageTier)) return false;
        uint64 asOfBlock = _scores[chainId][agentId].asOfBlock;
        if (block.number < asOfBlock) return false;
        return (block.number - asOfBlock) <= maxAgeBlocks;
    }

    /// @notice Step 1 of 2: nominate a new owner. Current owner keeps full rights until step 2.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2 of 2: the nominated owner claims the role.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
