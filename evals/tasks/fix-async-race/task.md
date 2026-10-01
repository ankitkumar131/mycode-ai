# fix-async-race

**Category:** concurrency

src/cache.js has a race: concurrent get() calls for the same key each fetch independently. Make concurrent requests for the same key share a single in-flight fetch. Existing tests must pass.
