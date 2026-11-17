import type { BoardInput, DeskInput, Lists, StoryDetail, UpdatePage } from './board.ts';
import type { Brief, PostPage, StoryPage } from './common.ts';
import { type CallExamples, fromJson } from './common.ts';
import board from './examples/board.json' with { type: 'json' };

/** The board's and the stories' examples (social/examples/board.json). */
export const lists: Lists = fromJson(board, 'lists');
export const boardInput: BoardInput = fromJson(board, 'board.input');
export const storyPage: StoryPage = fromJson(board, 'board.output');
export const storyAddress = fromJson<{ id: string }>(board, 'stories.get.input');
export const storyDetail: StoryDetail = fromJson(board, 'stories.get.output');
export const updatesInput = fromJson<{ id: string; limit: number; cursor: string }>(
  board,
  'stories.updates.input',
);
export const updatePage: UpdatePage = fromJson(board, 'stories.updates.output');
export const deskInput: DeskInput = fromJson(board, 'stories.posts.input');
export const deskPage: PostPage = fromJson(board, 'stories.posts.output');
export const briefAddress = fromJson<{ id: string }>(board, 'stories.brief.input');
export const brief: Brief = fromJson(board, 'stories.brief.output');

export const boardExamples = {
  'social.lists': { output: lists },
  'social.board': { input: boardInput, output: storyPage },
  'social.stories.get': { input: storyAddress, output: storyDetail },
  'social.stories.updates': { input: updatesInput, output: updatePage },
  'social.stories.posts': { input: deskInput, output: deskPage },
  'social.stories.brief': { input: briefAddress, output: brief },
} satisfies CallExamples;
