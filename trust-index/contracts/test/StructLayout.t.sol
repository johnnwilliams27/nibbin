// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {TestBase} from "./utils/TestBase.sol";
import {ScoreOracle} from "../src/ScoreOracle.sol";

/// @notice Cross-checks that `abi.encode(AgentScore)` matches a byte layout built by hand from
/// the field order in packages/types/src/oracle.ts (score, scoreLow, scoreHigh, confidence,
/// nEff, coverageTier, lifecycleState, ownershipEpoch, asOfBlock, methodologyVersion). AgentScore
/// has only static (non-dynamic) members, so ABI encoding it is exactly its ten fields each
/// widened to a 32-byte word and concatenated, in declared order, with no offset pointer. If a
/// future edit reorders or retypes a field in the struct without updating this test, the two
/// byte strings stop matching and the test fails loudly.
contract StructLayoutTest is TestBase {
    function test_AgentScore_AbiEncoding_MatchesHandBuiltLayout() public pure {
        ScoreOracle.AgentScore memory s = ScoreOracle.AgentScore({
            score: -12345,
            scoreLow: -22222,
            scoreHigh: 33333,
            confidence: 44444,
            nEff: 555_555,
            coverageTier: 3,
            lifecycleState: 2,
            ownershipEpoch: 777_777,
            asOfBlock: 8_888_888_888,
            methodologyVersion: 1_002_003
        });

        bytes memory actual = abi.encode(s);

        bytes memory expected = abi.encodePacked(
            _word(int256(s.score)),
            _word(int256(s.scoreLow)),
            _word(int256(s.scoreHigh)),
            _word(uint256(s.confidence)),
            _word(uint256(s.nEff)),
            _word(uint256(s.coverageTier)),
            _word(uint256(s.lifecycleState)),
            _word(uint256(s.ownershipEpoch)),
            _word(uint256(s.asOfBlock)),
            _word(uint256(s.methodologyVersion))
        );

        assertEq(actual.length, expected.length, "encoded length: ten 32-byte words, no offset pointer");
        assertEq(actual, expected, "AgentScore field order or width has drifted from oracle.ts");
    }

    function _word(int256 v) private pure returns (bytes32) {
        return bytes32(uint256(v));
    }

    function _word(uint256 v) private pure returns (bytes32) {
        return bytes32(v);
    }
}
