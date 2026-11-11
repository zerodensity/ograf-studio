export const OGRAF_CLIENT_SETUP = {
  archiveName: 'ograf-authoring.zip',
  exportFlag: '--export-skill',
  promptFlag: '--print-setup-prompt',
  mcpServerName: 'ograf-editor',
  codexSkillPath: '~/.agents/skills/ograf-authoring',
  claudeCodeSkillPath: '~/.claude/skills/ograf-authoring',
  claudeDesktopSkillMenu: 'Customize → Skills → Upload a skill',
} as const;
