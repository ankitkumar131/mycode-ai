# remove-dead-code

**Category:** cleanup

src/util.js contains functions that are never imported anywhere in src/. Delete the dead exports, keep everything that is used, and make sure the tests still pass.
