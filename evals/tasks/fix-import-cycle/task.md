# fix-import-cycle

**Category:** architecture

src/a.js and src/b.js import each other, which makes one of them undefined at load time and breaks the test. Break the cycle without changing the test file or the public exports.
