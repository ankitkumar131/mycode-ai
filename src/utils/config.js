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

    // Merge with defaults so new preference fields are always present
    return {
      ...getDefaultSettings(),
      ...config,
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
 * Get providers sorted by priority (ascending — 1 is highest).
 * @returns {Array} Sorted provider list
 */
export function getProvidersSorted() {
  const config = loadConfig();
  return [...config.providers].sort((a, b) => a.priority - b.priority);
}

/**
 * Add a provider to the configuration.
 * @param {object} provider - Provider config object
 */
export function addProvider(provider) {
  const config = loadConfig();
  config.providers.push(provider);
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
