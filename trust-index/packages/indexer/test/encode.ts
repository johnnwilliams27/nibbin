/**
 * Test-only helper: build RawLog values that decode.ts can decode, using the
 * same ABI it decodes against. This proves decode.ts is internally
 * consistent (round-trips what viem would produce for a log matching our
 * guessed ABI); it does not and cannot prove the ABI matches the deployed
 * contracts (see abi.ts UNVERIFIED note).
 */
import { encodeAbiParameters, encodeEventTopics, type AbiEvent } from "viem";
import type { RawLog } from "../src/chainSource.js";

export function encodeLog(
  event: AbiEvent,
  args: Record<string, unknown>,
  blockContext: { blockNumber: number; blockHash: string; transactionHash: string; logIndex: number },
  address = "0x0000000000000000000000000000000000dead",
): RawLog {
  const topics = encodeEventTopics({ abi: [event], eventName: event.name, args } as never);
  const nonIndexed = event.inputs.filter((i) => !i.indexed);
  const data =
    nonIndexed.length === 0
      ? "0x"
      : encodeAbiParameters(
          nonIndexed.map((i) => ({ name: i.name, type: i.type })),
          nonIndexed.map((i) => args[i.name as string]),
        );
  return {
    address,
    topics,
    data,
    blockNumber: blockContext.blockNumber,
    blockHash: blockContext.blockHash,
    transactionHash: blockContext.transactionHash,
    logIndex: blockContext.logIndex,
  };
}
