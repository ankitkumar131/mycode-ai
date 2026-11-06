#Requires -Version 5.1
<#
.SYNOPSIS
  Phase 0 helper: install Bun (Windows x64) for the OpenTUI spike.
  Safe to re-run. Does not touch npm/Node project files.
  See plan_opencode.md Phase 0.
#>
$ErrorActionPreference = 'Stop'

$existing = Get-Command bun -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Bun already installed: $($existing.Source)"
  & bun --version
  exit 0
}

Write-Host 'Installing Bun for Windows (x64)...'
try {
  irm bun.sh/install.ps1 | iex
} catch {
  Write-Error "Bun install failed: $($_.Exception.Message). See https://bun.sh/docs/installation for manual steps."
  exit 1
}

$after = Get-Command bun -ErrorAction SilentlyContinue
if (-not $after) {
  Write-Error 'Bun installed but not on PATH in this session. Restart the terminal, then run `bun --version`.'
  exit 1
}
& bun --version
Write-Host 'Next: `bun add @opentui/core@0.5.17 @opentui/solid @opentui/keymap solid-js opentui-spinner` in a scratch dir (NOT in npm workspaces yet).'
