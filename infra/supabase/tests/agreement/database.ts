import pg from 'pg';

/**
 * A connection to the throwaway database the Database check builds from the migrations: the
 * slot's own on this Mac, config.toml's in GitHub. `infra/slots/slot db test` (which
 * `pnpm test:db` runs) gives its address in TEST_DATABASE_URL. The session is set to UTC, so
 * times read back in UTC, the way the agreement writes them.
 */
export async function connect(): Promise<pg.Client> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('Run these through `infra/slots/slot db test` (or `pnpm test:db`)');
  }
  const client = new pg.Client({
    connectionString,
    options: '-c TimeZone=UTC',
    application_name: 'hrizzup-content-store-tests',
  });
  await client.connect();
  return client;
}

/**
 * Each test runs inside its own transaction, rolled back at the end, so nothing is left behind.
 * `attempt` runs one change inside it and gives back the error the database raised, or null if
 * it took the change; a refused change is undone, and the transaction goes on.
 */
export function transactions(db: () => pg.Client) {
  const reset = async () => {
    // Back to each rule's own timing: the rules across records wait for the commit again.
    await db().query('set constraints all deferred');
  };
  return {
    async begin() {
      await db().query('begin');
    },
    async rollback() {
      await db().query('rollback');
    },
    /** Runs the rules that wait for the commit now, so later checks see only what follows. */
    async settle() {
      await db().query('set constraints all immediate');
      await reset();
    },
    /**
     * Runs one change and gives back the database's refusal, or null. With `atCommit`, it also
     * runs the rules the database checks when a transaction commits; without, only the rules
     * every statement checks.
     */
    async attempt(
      change: () => Promise<unknown>,
      { atCommit = true } = {},
    ): Promise<pg.DatabaseError | null> {
      await db().query('savepoint attempt');
      try {
        await change();
        if (atCommit) await db().query('set constraints all immediate');
      } catch (error) {
        await db().query('rollback to savepoint attempt');
        await reset();
        if (error instanceof pg.DatabaseError) return error;
        throw error;
      }
      await db().query('release savepoint attempt');
      await reset();
      return null;
    },
  };
}
