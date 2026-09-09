# Public buyer reviews — design for review

Status: written design approved by the user; implementation in progress.

## Outcome

Close the marketplace journey: hire, inspect delivery, settle, then leave a public
buyer review. Job 1179 is confirmed Completed on BNB testnet at block 129997818;
the buyer must supply their own rating and text. No invented review will be
published under their wallet or attributed to their job.

## Scope and boundaries

- Add a 1–5 integer rating and optional plain-text comment (maximum 1,000 characters).
- Public reviews require a wallet signature and server verification of a completed
  job. Signing a review is not a transaction, token approval or gas payment.
- Launch verified submission for the existing Nibbin reference testnet seller.
  Model the subject separately from a registry token: it is a Nibbin-owned,
  independently unrated reference deployment, not one of the ranked listings.
- Other cards get a review section and accurate availability/empty states.
  Enable verified submission for another agent only after the service has an
  authoritative mapping from that agent identity to its commerce seller wallet.
  Do not assume a registry owner, endpoint owner and commerce provider are identical.
- Keep genuine testnet reviews, genuine mainnet reviews, and fictional demo examples
  in separate collections and summaries. No changes to Trust Index scoring or sort.
- Do not implement upvotes, token rewards, paid reviews or mainnet review submission
  in this first slice. Do not broaden the reference seller's signing authority.

## Chosen architecture and alternatives

Keep the marketplace's static export. Add a separately deployed review API backed
by durable PostgreSQL storage. Reuse the repository's Postgres tooling where it
fits, but isolate the review data from indexed third-party reputation and the
seller's signing service. The API holds database access, never a wallet key.

Browser-only drafts cannot satisfy public publication. On-chain review text would
add gas costs and permanent disclosure, so it is not the chosen approach.

A deployable database and its costs/access have not yet been verified. No paid
plan or production database migration is authorized by this design alone. Build
and test locally, then resolve storage provisioning before claiming public launch.

## Identity, signature and persistence

1. The browser requests a short-lived challenge for the selected job and subject.
   The service checks a fixed, supported chain/commerce contract and mapped provider.
2. The browser previews the full review and its public nature, then asks the buyer
   to sign a human-readable, versioned Nibbin review message. Bind the exact rating
   and comment, API audience, subject, chain, commerce contract, job ID, buyer,
   random nonce, issued time and expiration. Signature request occurs only on click.
3. On submission, the server validates sizes/schema and challenge, verifies the
   signature, and reads the confirmed on-chain job. Require Completed status,
   exact buyer, mapped provider, supported router/hook, and matching job ID.
   A connected wallet or client-supplied status is never sufficient proof.
4. Use a database transaction to consume the challenge and insert the review.
   Enforce a unique constraint on (chain, commerce contract, job ID), not just a
   JavaScript duplicate check. Identical retries return the original success;
   attempts to change the review return a clear conflict. No editing in v1.
5. Store rating/text, signature and signed message, subject, public buyer address,
   job identifiers, verification block/hash and server timestamp. Do not store
   private keys, full task descriptions or wallet balances.

Reviews are public off-chain records. Explain that the wallet address, job ID,
rating and comment will be public before signing. Reject control characters and
render comments as text, never HTML. Do not fetch user-provided URLs. RPC failure
or unavailable storage fails closed, without a Published confirmation.

## API and abuse boundaries

- POST challenge: bounded request, 10-minute expiry, rate limited; server nonce.
- POST review: bounded signed payload; atomic deduplication and challenge use.
- GET subject reviews: cursor pagination and separate network summaries; public
  responses exclude unused challenges and internal operational metadata.
- GET batched summaries: one bounded page of subjects per request, rather than
  one RPC/database round trip for each homepage card.
- CORS allows configured marketplace origins; it is not authentication.
- Fixed RPC destinations, timeouts and rate limits precede expensive verification.
- One wallet is not one human; display unique buyer wallets, not unique people.
- Support operator removal from public display for abusive content, with an audit
  reason and summaries recalculated from visible records. No public admin endpoint.

## User experience

After Completed, show a compact success panel and Leave a review. Preserve the
completed job when the user opens, cancels or submits the review. A resumed
completed job also permits review; an expired quote must not prevent reviewing.

The form has accessible rating controls, a labelled optional comment, a clear
public-disclosure notice and Sign and publish review. Handle rejected signatures,
account/network changes, already-reviewed jobs and unavailable service explicitly.
Show success only after the service confirms durable publication.

On agent cards, place the buyer-review summary below Trust Index. Mainnet summary
uses stars, count and unique buyer-wallet count when available. Testnet summary is
explicitly labelled Testnet reviews and never blended into that number. With no
reviews show No buyer reviews yet; if loading fails show Reviews unavailable,
not a fabricated zero. The reference deployment stays in the separate demo area.

Expandable details show reviews without forcing navigation away. A clearly
separated Demo examples disclosure contains a few fictional, varied sample reviews.
Each example says Demo review — fictional example. Examples never get real wallet
addresses, real job IDs, verified badges, dates implying real activity, or aggregate
rating weight. Do not attribute fictional experiences to third-party agents.

## Verification and release gate

Test valid signature and Completed job; wrong signer/provider/subject/chain;
unfinished/rejected/expired job; tampered text/rating; expired/replayed challenge;
simultaneous duplicate submissions; RPC/storage failure; oversized and HTML-like
input; pagination; and strict exclusion of testnet/demo data from mainnet summaries.

Test card loading/empty/error/demo states, keyboard access, mobile wrapping, and
the real Chrome/MetaMask path. User supplies actual review text and confirms the
message signature; the assistant must not choose or submit feedback on their behalf.

Before public launch: provision durable storage without an unapproved paid plan,
apply migration to an isolated database, review security and claims, deploy the API
and marketplace, then submit the buyer's genuine job-1179 review and verify it from
a separate browser without the buyer's local storage. That last check proves public
persistence; offline tests and a local preview do not.
