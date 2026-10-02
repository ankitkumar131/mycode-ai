# Root cause

`load()` spread the user's partial configuration as the base object, so any key the user did not supply was simply absent rather than filled in from `DEFAULTS`. The `DEFAULTS` object was declared but never read anywhere in the module, which is why the failure was silent: callers received a structurally valid object that was missing `retries` and `verbose`. The fix merges defaults first and overlays the user's values on top, so partial configuration is additive and explicit keys still win.
