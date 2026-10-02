# add-retry-with-backoff

**Category:** resilience

src/net.js does a single attempt and throws on failure. Add retry logic: up to 3 attempts total, with exponential backoff (10ms, 20ms). Do not retry on a 4xx error. Keep the same public signature.
