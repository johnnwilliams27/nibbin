// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {vm} from "./utils/Vm.sol";
import {TestBase} from "./utils/TestBase.sol";
import {ScoreOracle} from "../src/ScoreOracle.sol";

contract ScoreOracleTest is TestBase {
    ScoreOracle internal oracle;
    address internal owner = address(0xA11CE);
    address internal stranger = address(0xB0B);

    uint256 internal constant CHAIN = 8453;
    uint256 internal constant AGENT = 1;

    function setUp() public {
        oracle = new ScoreOracle(owner);
    }

    // -- setScores: round trip, length checks, access control ---------------

    function _distinctScore() internal pure returns (ScoreOracle.AgentScore memory) {
        return ScoreOracle.AgentScore({
            score: 8123,
            scoreLow: 7654,
            scoreHigh: 8765,
            confidence: 9012,
            nEff: 34567,
            coverageTier: 3,
            lifecycleState: 2,
            ownershipEpoch: 5,
            asOfBlock: 999_999,
            methodologyVersion: 1_002_003
        });
    }

    function _setOne(uint256 chainId, uint256 agentId, ScoreOracle.AgentScore memory s) internal {
        uint256[] memory chainIds = new uint256[](1);
        uint256[] memory agentIds = new uint256[](1);
        ScoreOracle.AgentScore[] memory scores = new ScoreOracle.AgentScore[](1);
        chainIds[0] = chainId;
        agentIds[0] = agentId;
        scores[0] = s;
        vm.prank(owner);
        oracle.setScores(chainIds, agentIds, scores);
    }

    function test_SetScores_RoundTripsAllFields() public {
        ScoreOracle.AgentScore memory s = _distinctScore();
        _setOne(CHAIN, AGENT, s);

        ScoreOracle.AgentScore memory got = oracle.getScore(CHAIN, AGENT);
        assertEq(int256(got.score), int256(s.score), "score");
        assertEq(int256(got.scoreLow), int256(s.scoreLow), "scoreLow");
        assertEq(int256(got.scoreHigh), int256(s.scoreHigh), "scoreHigh");
        assertEq(uint256(got.confidence), uint256(s.confidence), "confidence");
        assertEq(uint256(got.nEff), uint256(s.nEff), "nEff");
        assertEq(uint256(got.coverageTier), uint256(s.coverageTier), "coverageTier");
        assertEq(uint256(got.lifecycleState), uint256(s.lifecycleState), "lifecycleState");
        assertEq(uint256(got.ownershipEpoch), uint256(s.ownershipEpoch), "ownershipEpoch");
        assertEq(uint256(got.asOfBlock), uint256(s.asOfBlock), "asOfBlock");
        assertEq(uint256(got.methodologyVersion), uint256(s.methodologyVersion), "methodologyVersion");
        assertTrue(oracle.hasScore(CHAIN, AGENT), "hasScore true after write");
    }

    function test_SetScores_LengthMismatch_AgentIdsReverts() public {
        uint256[] memory chainIds = new uint256[](2);
        uint256[] memory agentIds = new uint256[](1);
        ScoreOracle.AgentScore[] memory scores = new ScoreOracle.AgentScore[](2);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ScoreOracle.LengthMismatch.selector));
        oracle.setScores(chainIds, agentIds, scores);
    }

    function test_SetScores_LengthMismatch_ScoresReverts() public {
        uint256[] memory chainIds = new uint256[](2);
        uint256[] memory agentIds = new uint256[](2);
        ScoreOracle.AgentScore[] memory scores = new ScoreOracle.AgentScore[](1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ScoreOracle.LengthMismatch.selector));
        oracle.setScores(chainIds, agentIds, scores);
    }

    function test_SetScores_NonOwnerReverts() public {
        uint256[] memory chainIds = new uint256[](1);
        uint256[] memory agentIds = new uint256[](1);
        ScoreOracle.AgentScore[] memory scores = new ScoreOracle.AgentScore[](1);
        chainIds[0] = CHAIN;
        agentIds[0] = AGENT;
        scores[0] = _distinctScore();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ScoreOracle.NotOwner.selector));
        oracle.setScores(chainIds, agentIds, scores);
    }

    function test_HasScore_UnknownAgent_False() public view {
        assertFalse(oracle.hasScore(CHAIN, 404), "unwritten pair has no score");
    }

    function test_GetScore_UnknownAgent_Reverts() public {
        vm.expectRevert(abi.encodeWithSelector(ScoreOracle.UnknownAgent.selector));
        oracle.getScore(CHAIN, 404);
    }

    // -- meetsThreshold: fail-closed truth table -----------------------------

    int32 internal constant MIN_SCORE = 7000;
    uint16 internal constant MIN_CONFIDENCE = 8000;
    uint8 internal constant MIN_TIER = 2;

    function _passingScore() internal pure returns (ScoreOracle.AgentScore memory) {
        return ScoreOracle.AgentScore({
            score: 8000,
            scoreLow: 7500,
            scoreHigh: 8500,
            confidence: 9000,
            nEff: 5000,
            coverageTier: 3,
            lifecycleState: 2,
            ownershipEpoch: 1,
            asOfBlock: 100,
            methodologyVersion: 100_000
        });
    }

    function test_MeetsThreshold_AllPass_ReturnsTrue() public {
        _setOne(CHAIN, AGENT, _passingScore());
        assertTrue(oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER), "all thresholds met");
    }

    function test_MeetsThreshold_UnknownAgent_ReturnsFalse() public view {
        assertFalse(oracle.meetsThreshold(CHAIN, 404, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER), "unknown agent fails closed");
    }

    function test_MeetsThreshold_SentinelScore_ReturnsFalse() public {
        ScoreOracle.AgentScore memory s = _passingScore();
        s.score = -1;
        _setOne(CHAIN, AGENT, s);
        assertFalse(oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER), "sentinel score fails closed");
    }

    function test_MeetsThreshold_CoverageTierZero_ReturnsFalse() public {
        ScoreOracle.AgentScore memory s = _passingScore();
        s.coverageTier = 0;
        _setOne(CHAIN, AGENT, s);
        assertFalse(oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER), "coverageTier 0 fails closed");
    }

    function test_MeetsThreshold_ScoreBelowMin_ReturnsFalse() public {
        ScoreOracle.AgentScore memory s = _passingScore();
        s.score = MIN_SCORE - 1;
        _setOne(CHAIN, AGENT, s);
        assertFalse(oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER), "score below floor fails closed");
    }

    function test_MeetsThreshold_ConfidenceBelowMin_ReturnsFalse() public {
        ScoreOracle.AgentScore memory s = _passingScore();
        s.confidence = MIN_CONFIDENCE - 1;
        _setOne(CHAIN, AGENT, s);
        assertFalse(oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER), "confidence below floor fails closed");
    }

    function test_MeetsThreshold_CoverageTierBelowMin_ReturnsFalse() public {
        ScoreOracle.AgentScore memory s = _passingScore();
        s.coverageTier = MIN_TIER - 1; // 1: below MIN_TIER but not the tier-0 case above
        _setOne(CHAIN, AGENT, s);
        assertFalse(oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER), "tier below floor fails closed");
    }

    // -- meetsThreshold with maxAgeBlocks staleness overload -----------------

    function test_MeetsThresholdWithAge_WithinBudget_ReturnsTrue() public {
        _setOne(CHAIN, AGENT, _passingScore()); // asOfBlock = 100
        vm.roll(150);
        assertTrue(
            oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER, 50), "50 blocks old, budget 50, passes"
        );
    }

    function test_MeetsThresholdWithAge_BeyondBudget_ReturnsFalse() public {
        _setOne(CHAIN, AGENT, _passingScore()); // asOfBlock = 100
        vm.roll(151);
        assertFalse(
            oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER, 50), "51 blocks old, budget 50, fails"
        );
    }

    function test_MeetsThresholdWithAge_StillAppliesOtherFailClosedBranches() public {
        ScoreOracle.AgentScore memory s = _passingScore();
        s.coverageTier = 0;
        _setOne(CHAIN, AGENT, s);
        vm.roll(100);
        assertFalse(
            oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER, type(uint64).max),
            "tier-0 still fails closed even with unlimited age budget"
        );
    }

    function test_MeetsThreshold_BaseOverload_NeverEnforcesStaleness() public {
        _setOne(CHAIN, AGENT, _passingScore()); // asOfBlock = 100
        vm.roll(10_000_000);
        assertTrue(
            oracle.meetsThreshold(CHAIN, AGENT, MIN_SCORE, MIN_CONFIDENCE, MIN_TIER),
            "base overload ignores age entirely, per SPEC 20.2"
        );
    }

    // -- batch gas measurement (see docs/NOTES-track-c.md for the recorded number) --

    function test_SetScores_Batch100_WritesAllAndReadsBack() public {
        uint256 n = 100;
        uint256[] memory chainIds = new uint256[](n);
        uint256[] memory agentIds = new uint256[](n);
        ScoreOracle.AgentScore[] memory scores = new ScoreOracle.AgentScore[](n);
        for (uint256 i = 0; i < n; i++) {
            chainIds[i] = CHAIN;
            agentIds[i] = i + 1;
            ScoreOracle.AgentScore memory s = _passingScore();
            s.score = int32(uint32(6000 + i));
            scores[i] = s;
        }

        vm.prank(owner);
        oracle.setScores(chainIds, agentIds, scores);

        assertTrue(oracle.hasScore(CHAIN, 1), "first of batch written");
        assertTrue(oracle.hasScore(CHAIN, 100), "last of batch written");
        assertEq(int256(oracle.getScore(CHAIN, 57).score), int256(int32(6056)), "sampled mid-batch value round-trips");
    }
}
