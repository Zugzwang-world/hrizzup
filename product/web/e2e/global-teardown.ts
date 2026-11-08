import { rm } from 'node:fs/promises';
import { statesFolder } from './support/states.ts';

/** Deletes the run's saved sign-in states (bypass cookie and test sessions) once it ends. */
export default async function globalTeardown() {
  await rm(statesFolder(), { recursive: true, force: true });
}
