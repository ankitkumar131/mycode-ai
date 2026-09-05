/**
 * Skills tools — progressive-disclosure access to the skills library.
 *
 *   skills_list()                 → compact index (Level 0)
 *   skill_view(name[, path])      → SKILL.md or a reference file (Level 1/2)
 *   skill_manage(action, ...)     → create / edit / patch / delete skills (agent self-improvement)
 */

import type { ToolModule } from '../types.js';
import { skillManager } from '../../skills/skill-manager.js';

export const skillsListTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'skills_list',
      description:
        'List available skills (reusable procedures / knowledge documents). Returns name, description and category. Call skill_view to load a skill before following it.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional category filter' },
          query: { type: 'string', description: 'Optional substring filter on name/description/tags' },
        },
      },
    },
  },
  async execute(args, cwd) {
    const category = typeof args.category === 'string' ? args.category.toLowerCase() : '';
    const query = typeof args.query === 'string' ? args.query.toLowerCase() : '';
    let skills = skillManager.list(cwd);
    if (category) skills = skills.filter(s => (s.category ?? '').toLowerCase() === category);
    if (query) {
      skills = skills.filter(
        s =>
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.tags.some(t => t.toLowerCase().includes(query))
      );
    }
    if (skills.length === 0) return 'No skills found.';
    const lines = skills.map(s => `- ${s.name}${s.category ? ` [${s.category}]` : ''}: ${s.description || '(no description)'}`);
    return `${skills.length} skill(s):\n${lines.join('\n')}`;
  },
};

export const skillViewTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'skill_view',
      description:
        'Load the full content of a skill (SKILL.md), or a specific reference file inside the skill directory. Use after skills_list when a skill matches the task.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name' },
          path: { type: 'string', description: 'Optional file inside the skill, e.g. "references/api.md"' },
        },
        required: ['name'],
      },
    },
  },
  async execute(args, cwd) {
    const name = typeof args.name === 'string' ? args.name : '';
    const path = typeof args.path === 'string' ? args.path : undefined;
    if (!name) throw new Error('name is required');
    return skillManager.view(name, path, cwd);
  },
};

export const skillManageTool: ToolModule = {
  definition: {
    type: 'function',
    function: {
      name: 'skill_manage',
      description:
        'Create, edit, patch or delete a skill so knowledge persists across sessions. Use "create" after completing a non-trivial multi-step task that is likely to recur, "patch" to fix a skill that led you astray, "write_file" to add reference material.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'edit', 'patch', 'delete', 'write_file', 'delete_file'],
            description: 'Operation to perform',
          },
          name: { type: 'string', description: 'Skill name (kebab-case)' },
          content: { type: 'string', description: 'Full SKILL.md content (create/edit) or file content (write_file). Include YAML frontmatter with name/description.' },
          old_text: { type: 'string', description: 'Text to replace (patch)' },
          new_text: { type: 'string', description: 'Replacement text (patch)' },
          file_path: { type: 'string', description: 'Relative file path inside the skill (write_file/delete_file), e.g. references/notes.md' },
          scope: { type: 'string', enum: ['user', 'workspace'], description: 'Where to create: user (~/.mycode/skills, default) or workspace (.mycode/skills)' },
          overwrite: { type: 'boolean', description: 'Allow overwriting an existing skill on create' },
        },
        required: ['action', 'name'],
      },
    },
  },
  async execute(args, cwd, options) {
    const action = String(args.action ?? '');
    const name = String(args.name ?? '');
    const content = typeof args.content === 'string' ? args.content : '';
    const filePath = typeof args.file_path === 'string' ? args.file_path : '';

    if (!name) throw new Error('name is required');

    // Destructive operations go through the same approval gate as file writes.
    if ((action === 'delete' || action === 'delete_file' || action === 'edit' || (action === 'create' && args.overwrite)) && options?.confirmFn) {
      const ok = await options.confirmFn(`skill ${action}: ${name}${filePath ? '/' + filePath : ''}`, 'Modify skills library');
      if (!ok) return 'Skill change cancelled by user.';
    }

    switch (action) {
      case 'create': {
        if (!content) throw new Error('content is required for create');
        const p = skillManager.createSkill(name, content, {
          overwrite: args.overwrite === true,
          workspaceRoot: cwd,
          scope: args.scope === 'workspace' ? 'workspace' : 'user',
        });
        return `Created skill "${name}" at ${p}. It is now available as /${name}.`;
      }
      case 'edit': {
        if (!content) throw new Error('content is required for edit');
        const p = skillManager.editSkill(name, content, cwd);
        return `Updated skill "${name}" (${p}).`;
      }
      case 'patch': {
        const oldText = typeof args.old_text === 'string' ? args.old_text : '';
        const newText = typeof args.new_text === 'string' ? args.new_text : '';
        if (!oldText) throw new Error('old_text is required for patch');
        const p = skillManager.patchSkill(name, oldText, newText, cwd);
        return `Patched skill "${name}" (${p}).`;
      }
      case 'write_file': {
        if (!filePath) throw new Error('file_path is required for write_file');
        const p = skillManager.writeSkillFile(name, filePath, content, cwd);
        return `Wrote ${p}.`;
      }
      case 'delete_file': {
        if (!filePath) throw new Error('file_path is required for delete_file');
        skillManager.deleteSkillFile(name, filePath, cwd);
        return `Deleted ${name}/${filePath}.`;
      }
      case 'delete': {
        const ok = skillManager.removeSkill(name, cwd);
        return ok ? `Deleted skill "${name}".` : `Skill "${name}" not found.`;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  },
};
