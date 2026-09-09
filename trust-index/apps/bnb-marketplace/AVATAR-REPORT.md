# Agent avatars

## Delivered

- Cards retain the category icon and agent name on the left; a fixed 56 × 56 px avatar sits on the right.
- Registry image URLs render through a standard lazy-loaded `img`, with explicit dimensions, asynchronous decoding, and `no-referrer`.
- Missing, rejected, or failed images show short Unicode-aware name initials in the same-size container. A failed URL is not repeatedly retried; a changed URL can load normally.
- Avatars are decorative beside the existing visible agent name (`alt=""`, hidden from assistive technology), avoiding duplicate announcements.
- HTTPS public-DNS URLs only: credentials, other schemes, relative URLs, local names, and IP literals are rejected. This is a browser URL policy, not DNS pinning, image-content verification, or proof of agent identity. Ordinary browser image requests still disclose the viewer's IP to the remote image host.
- The design-system and brand-voice guidance informed restrained sizing, existing dark marketplace tokens, and no verification-like avatar badges. Current Source Sans marketplace styling takes precedence over the legacy light creature reference.

## Verification

- Seven focused tests pass: URL acceptance/rejection, Unicode initials, failed-source fallback/recovery, and actual rendered markup for image dimensions, loading/referrer policy, accessibility, and request-free fallback.
- Marketplace TypeScript check passed after the avatar implementation.
- Full marketplace suite passed all 69 tests after adding the rendering tests; TypeScript check passed in the same verification run. The existing Node typeless-package warning remains unchanged.
- Root's browser check confirmed real CrimsonNomad/CrimsonRanger images, the BNB Yield Optimizer initials fallback, right alignment, and preserved category icons.
- No bulk image download, registry mutation, dependency installation, commit, or deployment was performed for this change.

## Coordination

AgentCard now renders the review worker's `BuyerReviewSummary` below Trust Index and `BuyerReviews` in the expanded details, replacing the old “Coming soon” placeholder. The review worker owns the shared provider, network behavior, service UI, and demo-only examples. These consumers do not invent review scores when the API is unavailable.

Marketplace TypeScript verification also passed after the review components were integrated. Browser verification of the new review service states remains with the root/review-UI worker.
