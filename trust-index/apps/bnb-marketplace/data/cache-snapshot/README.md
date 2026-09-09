# Raw fetch cache — restorable snapshot

`raw-detail-cache.tar.gz` is `data/raw/detail/` (8,590 8004scan detail responses)
plus `data/raw/candidates.json`, at 2026-09-09. 81MB raw, 7.5MB compressed.

## Restore

```sh
cd trust-index/apps/bnb-marketplace
tar -xzf data/cache-snapshot/raw-detail-cache.tar.gz
python3 scripts/fetch_details.py 8      # fills only what is missing; cached files are never re-fetched
python3 scripts/build_dataset.py
```

## Why this exists when `data/raw/` is gitignored

The ignore rule calls this data "regenerable", which is true and was the right
call — but it is regenerable **at 1000 requests/hour**, the 8004scan rate limit.
A cold rebuild of all 10,041 details is roughly ten hours of wall-clock time
spent waiting on quota windows, and it was acquired across a full day of them.

Losing that to a reclaimed container would not lose any *information* — but it
would block anyone from rebuilding `data/agents.json` for most of a day, which
in practice means the dataset stops being reproducible on demand. A 7.5MB
tarball is a cheap way to keep the pipeline runnable from a fresh clone.

This is a snapshot, not the source of truth. It goes stale; `fetch_details.py`
is idempotent and tops it up. Re-snapshot when the gap closes, or drop this
directory entirely once fetching is no longer the bottleneck.

Contains only public 8004scan API responses about public on-chain agents. No
credentials, no personal data.
