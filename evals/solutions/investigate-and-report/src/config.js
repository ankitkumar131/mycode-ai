const DEFAULTS = { retries: 3, timeout: 1000, verbose: false };
export function load(userConfig) {
  return { ...DEFAULTS, ...userConfig };
}
