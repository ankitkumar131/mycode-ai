// MyCode SDK — programmatic API for the MyCode agent
//
// ```ts
// import { MyCodeAgent } from '@mycode/sdk';
//
// const agent = new MyCodeAgent({ providers: [{ name: 'local', apiProvider: 'ollama', model: 'llama3.1:8b' }] });
// const answer = await agent.run('summarise src/', { events: { onText: (t) => process.stdout.write(t) } });
// ```

export { MyCodeAgent } from './agent.js';
export { skillDir, discoverSkills, createSkill, loadSkillConfig } from './skills.js';
export type {
  AgentConfig,
  AgentEvents,
  AgentInfo,
  ConfirmRequest,
  ProviderRegistration,
  RunOptions,
  SkillConfig,
  ToolRegistration,
  MyCodeConfig,
  ProviderConfig,
  SafetyLevel,
  ToolCall,
  ToolResult,
} from './types.js';
