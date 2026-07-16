/**
 * Tests for context-resolver.js
 * Verifies that @file and @directory path resolution works.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContextReferences } from '../src/utils/context-resolver.js';
import { join } from 'path';

describe('ContextResolver', () => {
  it('should extract file references and append content', () => {
    const cwd = process.cwd();
    const prompt = 'Please explain this package @package.json';
    
    const { resolvedPrompt, filesInjected } = resolveContextReferences(prompt, cwd);
    
    assert.ok(filesInjected.includes('package.json'));
    assert.ok(resolvedPrompt.includes('--- Injected File Context: package.json ---'));
    assert.ok(resolvedPrompt.includes('"name": "@ankitkumar131/mycode-ai"'));
  });

  it('should ignore non-existent files', () => {
    const cwd = process.cwd();
    const prompt = 'Explain @nonexistent-file.js';
    
    const { resolvedPrompt, filesInjected } = resolveContextReferences(prompt, cwd);
    
    assert.equal(filesInjected.length, 0);
    assert.equal(resolvedPrompt, prompt);
  });

  it('should not confuse emails with files', () => {
    const cwd = process.cwd();
    const prompt = 'Send email to user@domain.com';
    
    const { resolvedPrompt, filesInjected } = resolveContextReferences(prompt, cwd);
    
    assert.equal(filesInjected.length, 0);
    assert.equal(resolvedPrompt, prompt);
  });
});
