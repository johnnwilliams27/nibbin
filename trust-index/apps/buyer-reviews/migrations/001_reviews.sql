BEGIN;
CREATE TABLE IF NOT EXISTS review_challenges (
 id uuid PRIMARY KEY, payload jsonb NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_challenges_expiry ON review_challenges(expires_at);
CREATE TABLE IF NOT EXISTS buyer_reviews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 subject text NOT NULL, chain_id integer NOT NULL CHECK(chain_id IN (56,97)),
 commerce text NOT NULL, job_id numeric(78,0) NOT NULL,
 buyer text NOT NULL, rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment text NOT NULL CHECK(length(comment)<=1000), message text NOT NULL, signature text NOT NULL,
 challenge_id uuid NOT NULL REFERENCES review_challenges(id),
 verification_block numeric(78,0) NOT NULL, verification_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), hidden_at timestamptz,
 UNIQUE(chain_id,commerce,job_id)
);
CREATE INDEX IF NOT EXISTS buyer_reviews_public_subject ON buyer_reviews(subject,id DESC) WHERE hidden_at IS NULL;
CREATE TABLE IF NOT EXISTS review_moderation (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, review_id bigint NOT NULL REFERENCES buyer_reviews(id),
 reason text NOT NULL, operator text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS review_rate_buckets (
 key text NOT NULL, bucket bigint NOT NULL, count integer NOT NULL, PRIMARY KEY(key,bucket)
);
CREATE INDEX IF NOT EXISTS review_rate_expiry ON review_rate_buckets(bucket);
COMMIT;
