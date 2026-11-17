/**
 * Social's part of the API's entry (`import { social } from '@hrizzup/api'`): every shape and type of
 * its calls, one area at a time, and how the areas join. Each area adds its exports in its own file,
 * and this file is changed only by a pull request that adds one (docs/social/build.md, 8.3).
 */
export * from './admin.ts';
export * from './agents.ts';
export * from './board.ts';
export * from './checkin.ts';
export * from './common.ts';
export { socialContract } from './contract.ts';
export * from './files.ts';
export * from './kit.ts';
export * from './media.ts';
export { joinAreas } from './merge.ts';
export * from './readers.ts';
export * from './replies.ts';
export * from './signals.ts';
export * from './skills.ts';
