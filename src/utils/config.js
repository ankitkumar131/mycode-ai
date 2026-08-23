/**
 * Configuration Manager
 * Handles reading/writing the ~/.mycode/settings.json file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** Path to the .mycode directory in the user's home folder */
export const CONFIG_DIR = join(homedir(), '.mycode');

/** Path to the settings.json file */
export const CONFIG_FILE = join(CONFIG_DIR, 'settings.json');

/** Path to conversation logs */
export const LOGS_DIR = join(CONFIG_DIR, 'logs');

/**
 * Default settings template
 */
function getDefaultSettings() {
  return {
    providers: [],
    preferences: {
      theme: 'dark',
      confirm_writes: true,
      confirm_commands: true,
      max_context_files: 20,
      log_conversations: true,
    },
  };
}

/**
 * Ensure the config directory exists.
 */
export function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Check if settings.json exists.
 * @returns {boolean}
 */
export function configExists() {
  return existsSync(CONFIG_FILE);
}

/**
 * Load settings from disk.
 * @returns {object} The settings object
 */
export function loadConfig() {
  ensureConfigDir();

  if (!configExists()) {
    return getDefaultSettings();
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const config = JSON.parse(raw);
    const providers = (config.providers || []).map((p) => {
      const out = { ...p };
      if (out.read === undefined) out.read = true;
      if (out.write === undefined) out.write = true;
      if (out.max_retries === undefined && out.maxRetries === undefined) out.max_retries = 3;
      return out;
    });

    const priorityCounts = new Map();
    let hasDuplicates = false;
    for (const p of providers) {
      const pr = p.priority ?? 99;
      if (priorityCounts.has(pr)) {
        hasDuplicates = true;
        break;
      }
      priorityCounts.set(pr, 1);
    }

    if (hasDuplicates) {
      providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
      providers.forEach((p, idx) => {
        p.priority = idx + 1;
      });
    }

    return {
      ...getDefaultSettings(),
      ...config,
      providers,
      preferences: {
        ...getDefaultSettings().preferences,
        ...(config.preferences || {}),
      },
    };
  } catch (err) {
    throw new Error(`Failed to parse settings.json: ${err.message}`);
  }
}

/**
 * Save settings to disk.
 * @param {object} config - The settings object to write
 */
export function saveConfig(config) {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
/**
 * Automatically adjust priorities on insert/update.
 * @param {Array} providers
 * @param {number} targetIndex
 * @returns {Array}
 */
export function adjustProviderPriorities(providers, targetIndex) {
  if (targetIndex < 0 || targetIndex >= providers.length) {
    return providers;
  }

  const targetPriority = providers[targetIndex].priority ?? 1;

  for (let i = 0; i < providers.length; i++) {
    if (i !== targetIndex) {
      const currentP = providers[i].priority ?? 1;
      if (currentP >= targetPriority) {
        providers[i].priority = currentP + 1;
      }
    }
  }

  providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  providers.forEach((p, idx) => {
    p.priority = idx + 1;
  });

  return providers;
}

/**
 * Get providers sorted by priority (ascending — 1 is highest).
 * @returns {Array} Sorted provider list
 */
export function getProvidersSorted() {
  const config = loadConfig();
  return [...config.providers].sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

/**
 * Add a provider to the configuration.
 * @param {object} provider - Provider config object
 */
export function addProvider(provider) {
  const config = loadConfig();
  config.providers.push(provider);
  adjustProviderPriorities(config.providers, config.providers.length - 1);
  saveConfig(config);
}

/**
 * Remove a provider by name.
 * @param {string} name - Provider name to remove
 * @returns {boolean} Whether a provider was removed
 */
export function removeProvider(name) {
  const config = loadConfig();
  const before = config.providers.length;
  config.providers = config.providers.filter(
    (p) => p.name.toLowerCase() !== name.toLowerCase()
  );
  if (config.providers.length < before) {
    config.providers.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
    config.providers.forEach((p, idx) => {
      p.priority = idx + 1;
    });
    saveConfig(config);
    return true;
  }
  return false;
}

/**
 * Update preferences.
 * @param {object} prefs - Partial preferences to merge
 */
export function updatePreferences(prefs) {
  const config = loadConfig();
  config.preferences = { ...config.preferences, ...prefs };
  saveConfig(config);
}
