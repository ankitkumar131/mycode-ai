# Fix Critical Chat Loop, Token Display, Update Check & File Write Performance

Four bugs reported by the user. Here is the root-cause analysis and proposed fix for each.

---

## Issue 1: Chat exits after one response (CRITICAL)

**Root cause:** The `readline` `line` event handler in [chat.js](file:///c:/Users/Admin/Desktop/mycode/src/commands/chat.js#L99-L123) fires `await agent.run(input)` **inside an event callback**. The `readline` interface does **not** await the promise — it fires `line` and keeps going. Meanwhile, the `rl.on('line', async …)` handler's `await` doesn't actually block readline. 

However, the **real culprit** is that `inquirer.prompt()` (used in `confirmFileWrite` / `confirmCommand` in [prompt.js](file:///c:/Users/Admin/Desktop/mycode/src/ui/prompt.js)) creates its own readline interface that **conflicts** with the existing one, and more importantly — the `Warning: Detected unsettled top-level await` error on line 59 of [mycode.js](file:///c:/Users/Admin/Desktop/mycode/bin/mycode.js#L59) is Node.js exiting because the process has nothing keeping it alive after `program.parseAsync()` resolves.

The core issue: `rl.on('line')` with an `async` callback doesn't prevent the readline from closing. When `agent.run()` completes, the `await new Promise(resolve => rl.once('close', resolve))` at line 125 is still waiting, BUT Node.js's event loop can terminate if it detects no pending work. The `readline` interface with `process.stdin` as its input can cause Node to exit if stdin is paused/consumed improperly.

**Fix:** Pause the readline input while the agent is processing, and ensure proper error handling. Also, switch from `inquirer.prompt()` to `readline`'s built-in question method for confirmations during chat to avoid stdin conflicts.

### Proposed Changes

#### [MODIFY] [chat.js](file:///c:/Users/Admin/Desktop/mycode/src/commands/chat.js)

- In the `rl.on('line')` handler, **pause** readline input before calling `agent.run()` and **resume + re-prompt** after.
- Wrap the async handler properly so unhandled rejections don't crash.
- Pass a custom `confirmFn` that uses the existing readline instance instead of `inquirer`.

#### [MODIFY] [prompt.js](file:///c:/Users/Admin/Desktop/mycode/src/ui/prompt.js)

- Add `createReadlineConfirmFn(rl)` that returns confirm functions using the existing readline interface (avoiding `inquirer` stdin conflicts).

---

## Issue 2: Token count showing `?`

**Root cause:** In [loop.js](file:///c:/Users/Admin/Desktop/mycode/src/agent/loop.js#L128-L136), the token display code checks `response.usage?.prompt_tokens` and `response.usage?.completion_tokens`. When streaming is used (chat mode), the `_streamResponse` method at [line 192-196](file:///c:/Users/Admin/Desktop/mycode/src/agent/loop.js#L192-L196) provides a **fallback estimated** usage object. However, the `usage` from the stream's `finish` event (line 177-179) is typically `null` for most OpenRouter free models — they don't return usage in streaming responses.

The fallback **does** estimate tokens, but the display code at line 130 uses `Number.isFinite()` which would return `true` for the estimates. 

Actually, looking more carefully: the issue is that the `hasUsage` check at line 130 fails. If `chunk.usage` from the provider is `null`, the fallback at line 192 kicks in. But the **first response** in the user's log shows `Tokens: 1677 in / 132 out` correctly, so the estimation IS working. The `Tokens: ? in / ? out` mentioned in the user's request might be from a different scenario. 

But to make this more robust, we should **always show estimated token counts** (using the `estimated` flag to mark them with `~`).

### Proposed Changes

#### [MODIFY] [loop.js](file:///c:/Users/Admin/Desktop/mycode/src/agent/loop.js)

- Always display token info after each response (remove the conditional `if (hasUsage)`)
- Show `~` prefix when tokens are estimated
- For non-streaming mode, add fallback estimation too

---

## Issue 3: Update checking not working visually

**Root cause:** The update check in [update-check.js](file:///c:/Users/Admin/Desktop/mycode/src/utils/update-check.js) and [mycode.js](file:///c:/Users/Admin/Desktop/mycode/bin/mycode.js#L43) **already runs on every launch**. It calls `renderBox()` if a newer version exists. The `renderBox` function in [renderer.js](file:///c:/Users/Admin/Desktop/mycode/src/ui/renderer.js#L90-L105) uses `padEnd` which doesn't account for chalk ANSI escape codes, so the box might render improperly on some terminals.

The user wants a **visible, prominent** update notification box. The current implementation looks fine functionally, but needs:
1. Better visual styling (use chalk colors inside the box content)
2. Show the exact `npm install -g` command prominently

### Proposed Changes

#### [MODIFY] [update-check.js](file:///c:/Users/Admin/Desktop/mycode/src/utils/update-check.js)

- Improve the update notification styling with colored text and clearer formatting
- Make the npm command stand out with a highlighted background

---

## Issue 4: File writing takes enormous/infinite time

**Root cause:** When the AI wants to write code, it calls `writeFile` or `editFile` tools. Both tools in [write-file.js](file:///c:/Users/Admin/Desktop/mycode/src/tools/write-file.js) and [edit-file.js](file:///c:/Users/Admin/Desktop/mycode/src/tools/edit-file.js) use **synchronous** file operations (`writeFileSync`, `readFileSync`) which are fast. The bottleneck is NOT the file I/O.

The actual bottleneck: when the AI generates a tool call with a `writeFile` that has large `content` (entire file contents as a string), the **streaming JSON tool_call arguments** in [openai-compatible.js](file:///c:/Users/Admin/Desktop/mycode/src/providers/openai-compatible.js#L108-L123) accumulate the arguments string character by character. For large files, the AI model itself takes a long time to generate the full content token-by-token. Free models on OpenRouter can be extremely slow (sometimes 5-20 tokens/sec for code generation).

Additionally, during tool call streaming, **no feedback** is shown to the user — the spinner just says "Thinking..." with no progress indicator.

### Proposed Changes

#### [MODIFY] [loop.js](file:///c:/Users/Admin/Desktop/mycode/src/agent/loop.js)

- Show a **progress indicator** during tool call argument streaming (bytes received)
- Show "Generating code..." message when tool calls are being streamed

#### [MODIFY] [openai-compatible.js](file:///c:/Users/Admin/Desktop/mycode/src/providers/openai-compatible.js)

- Add a new chunk type `tool_call_delta` that emits progress info during argument accumulation
- This allows the UI to show how many bytes of arguments have been received

#### [MODIFY] [spinner.js](file:///c:/Users/Admin/Desktop/mycode/src/ui/spinner.js)

- Add a `createCodegenSpinner()` that shows progress for code generation

---

## Verification Plan

### Manual Verification
1. Run `mycode chat`, send multiple messages — verify the REPL persists and doesn't exit
2. Verify token counts display after each response (with `~` prefix for estimates)
3. Bump version in a test scenario and verify the update box renders properly
4. Ask AI to write a file — verify progress indicator shows during generation
5. Verify the `Warning: Detected unsettled top-level await` error is gone
