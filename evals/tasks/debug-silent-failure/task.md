# debug-silent-failure

**Category:** bugfix

The test suite passes, but `sliceLast` returns the wrong result for an edge case. Find the logic error in src/list.js and fix it so that every input, including boundary values, behaves correctly. `node --test` must still pass and the public API must not change.
