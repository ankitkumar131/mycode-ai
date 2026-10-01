# extract-shared-helper

**Category:** refactor

src/report.js and src/invoice.js each contain the same rounding logic. Extract it into src/money.js as `roundMoney(cents)` and use it from both. Behaviour must not change.
