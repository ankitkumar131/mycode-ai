import { createInterface } from 'readline/promises';
import { ConfigManager, ProviderRouter } from '@mycode/core';

async function main() {
  const config = new ConfigManager();
  const cfg = config.configExists() ? await config.load() : config.get();
  console.log('Providers:', JSON.stringify(cfg.providers.map(p => ({ name: p.name, model: p.model, provider: p.apiProvider }))));
  
  const router = new ProviderRouter(cfg.providers);
  
  try {
    const result = await router.chat([{ role: 'user', content: 'hi' }], []);
    console.log('SUCCESS:', JSON.stringify(result));
  } catch (err) {
    console.log('FAILED:', err instanceof Error ? `${err.name}: ${err.message}` : err);
  }
}

main().catch(console.error);
