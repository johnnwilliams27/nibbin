/**
 * Test-only helper: build RawLog values that decode.ts can decode, using the
 * same ABI it decodes against.
 *
 * This proves decode.ts is internally consistent: it round-trips whatever viem
 * would produce for a log matching the committed ABI. It cannot prove the ABI
 * matches the deployed contracts, because both sides of the round trip come
 * from the same definition. That blind spot is real and it mattered once: an
 * earlier ABI was wrong in every event and these tests passed anyway. The
 * checks that close it are the captured live logs in
 * test/fixtures/live-base-logs.json, decoded in decode.test.ts, and
 * scripts/verify-abi.mts against a live chain.
 */
import { encodeAbiParameters, encodeEventTopics, getAddress, type AbiEvent } from "viem";
import type { RawLog } from "../src/chainSource.js";

/** viem's ABI encoders require every address argument to be checksummed; normalize before encoding. */
function checksumAddressArgs(event: AbiEvent, args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  for (const input of event.inputs) {
    const name = input.name as string | undefined;
    if (name === undefined || input.type !== "address") continue;
    const v = out[name];
    if (typeof v === "string") out[name] = getAddress(v);
  }
  return out;
}

export function encodeLog(
  event: AbiEvent,
  rawArgs: Record<string, unknown>,
  blockContext: { blockNumber: number; blockHash: string; transactionHash: string; logIndex: number },
  address = "0x000000000000000000000000000000000000ad",
): RawLog {
  const args = checksumAddressArgs(event, rawArgs);
  const rawTopics = encodeEventTopics({ abi: [event], eventName: event.name, args } as never);
  const topics = rawTopics.map((t) => {
    if (typeof t !== "string") throw new Error("encodeLog: expected every topic to be a concrete hash");
    return t;
  });
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
