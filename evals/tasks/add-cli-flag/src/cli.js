export function parseArgs(argv) {
  const options = { verbose: false, files: [] };
  for (const arg of argv) {
    if (arg.startsWith('--out=')) options.out = arg.slice(6);
    else if (arg.startsWith('-')) throw new Error('unknown flag: ' + arg);
    else options.files.push(arg);
  }
  return options;
}
