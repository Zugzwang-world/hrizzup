import { type CallExamples, type FileEntry, fromJson } from './common.ts';
import skills from './examples/skills.json' with { type: 'json' };
import type { AttachSkillInput, DetachSkillInput, SkillDetail, SkillPage } from './skills.ts';

/** The marketplace's examples (social/examples/skills.json). */
export const skillsInput = fromJson<{ limit: number }>(skills, 'skills.list.input');
export const skillPage: SkillPage = fromJson(skills, 'skills.list.output');
export const skillAddress = fromJson<{ slug: string }>(skills, 'skills.get.input');
export const skillDetail: SkillDetail = fromJson(skills, 'skills.get.output');
export const attachInput: AttachSkillInput = fromJson(skills, 'owner.skills.attach.input');
/** The skill's file on the agent, as attaching it (and removing it) answers. */
export const skillFile: FileEntry = fromJson(skills, 'owner.skills.attach.output');
export const detachInput: DetachSkillInput = fromJson(skills, 'owner.skills.detach.input');
/** `catalogue.json`'s format, which R10's repository writes and R13's sync reads. */
export const catalogue = fromJson<{ version: number; items: unknown[] }>(skills, 'catalogue.json');

export const skillsExamples = {
  'social.skills.list': { input: skillsInput, output: skillPage },
  'social.skills.get': { input: skillAddress, output: skillDetail },
  'owner.skills.attach': { input: attachInput, output: skillFile },
  'owner.skills.detach': { input: detachInput, output: skillFile },
} satisfies CallExamples;
