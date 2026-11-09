import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { AwsClient } from 'aws4fetch';
import { phone } from './phone.ts';

/**
 * Journey: a browser on this site uploads a file straight to staging's uploads bucket, the way
 * the posting screens will (blueprint section 13): our server signs a short-lived upload
 * address, and the browser sends the file there itself. It proves that the bucket's browser
 * rule (infra/cloudflare/r2/uploads.cors.staging.json) lets this site's address upload and read
 * the answer: staging, previews, and on this Mac each slot's own address (infra/slots).
 * The file is read back, then deleted; the bucket's own rule deletes anything left after a day.
 * Staging's bucket only: it refuses any other, and it doesn't run against production.
 */
test.use(phone);

const STAGING_UPLOADS = 'hrizzup-staging-uploads';

/** Staging's storage key and uploads bucket, from the environment (Doppler `stg_preview` or `dev`). */
function stagingUploads() {
  const env = process.env;
  const endpoint = env.R2_ENDPOINT?.replace(/\/$/, '');
  const bucket = env.R2_BUCKET_UPLOADS;
  if (!endpoint || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !bucket) {
    throw new Error(
      "Staging's storage keys are missing (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, " +
        'R2_BUCKET_UPLOADS), so the upload journey has nothing to sign with',
    );
  }
  if (bucket !== STAGING_UPLOADS) {
    throw new Error(`Uploads are tested only in staging's bucket; refusing ${bucket}`);
  }
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
  return { aws, address: (key: string) => `${endpoint}/${bucket}/${key}` };
}

test('a browser on this site uploads straight to the staging bucket', async ({
  page,
  browserName,
}) => {
  test.skip(
    process.env.SCREEN_CHECK_ENVIRONMENT === 'production',
    "Uploads are tested in staging's bucket only",
  );
  const { aws, address } = stagingUploads();
  const key = `_selftest/upload-journey/${browserName}-${randomUUID()}.txt`;
  const text = `The upload journey, ${new Date().toISOString()}`;

  // What our server will do: an upload address for this one file, good for five minutes.
  const upload = new URL(address(key));
  upload.searchParams.set('X-Amz-Expires', '300');
  const signed = await aws.sign(upload.href, { method: 'PUT', aws: { signQuery: true } });

  // The browser, on one of this site's pages, sends the file there itself.
  await page.goto('/');
  const answer = await page.evaluate(
    async ({ to, body }) => {
      try {
        const response = await fetch(to, {
          method: 'PUT',
          headers: { 'content-type': 'text/plain' },
          body,
        });
        return { status: response.status, etag: response.headers.get('etag') };
      } catch (error) {
        return { refused: String(error) };
      }
    },
    { to: signed.url, body: text },
  );

  try {
    expect(answer, "the bucket's browser rule lets this site's address upload").not.toHaveProperty(
      'refused',
    );
    expect(answer).toMatchObject({ status: 200 });
    expect(
      'etag' in answer ? answer.etag : null,
      'and lets it read the answer (the ETag)',
    ).toBeTruthy();
    const stored = await aws.fetch(address(key));
    expect(stored.status, 'the file reached the bucket').toBe(200);
    expect(await stored.text()).toBe(text);
  } finally {
    await aws.fetch(address(key), { method: 'DELETE' });
  }
});
