# Third-party notices

## Ponytail

`packages/core/src/prompts/ponytail.ts` vendors the rules, the intensity
levels and the configuration resolution order of **Ponytail**, adapted for
MyCode's tooling.

- Source: https://github.com/DietrichGebert/ponytail
- Version vendored: 4.10.0
- Licence: MIT
- Copyright (c) 2026 DietrichGebert

The upstream licence, as required for redistribution:

```
MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### What "vendored" means here

The rules text, the ladder, the three intensity levels, the `ponytail:` comment
marker convention and the `PONYTAIL_DEFAULT_MODE` → config file → `full`
resolution order are upstream's behaviour, reproduced so that a user of the
original tool gets what they expect. The adaptations are:

- the section is delivered through MyCode's system prompt rather than a plugin
  manifest, so it applies to every query without installation;
- the six commands are MyCode slash commands, rendered against MyCode's theme
  and tooling;
- `PONYTAIL_DEFAULT_MODE` is read at startup and `/ponytail` overrides it for
  the process, matching upstream's process-local runtime mode.

Upstream's own benchmarks are quoted in `/ponytail-gain`. They are the ponytail
project's published medians, labelled as such in the output, and are not
measurements of MyCode.
