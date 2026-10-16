import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config, isR2Configured } from '../config';

function client(): S3Client {
  if (!isR2Configured()) throw new Error('R2 storage is not configured');
  return new S3Client({
    region: config.R2_REGION,
    endpoint: config.R2_ENDPOINT || `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY
    }
  });
}

export async function createUploadUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: config.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType
  });
  return getSignedUrl(client(), command, { expiresIn: config.SIGNED_URL_SECONDS });
}

export async function getObjectInfo(key: string) {
  return client().send(new HeadObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key }));
}

export async function createDownloadUrl(key: string) {
  const command = new GetObjectCommand({ Bucket: config.R2_BUCKET_NAME, Key: key });
  return getSignedUrl(client(), command, { expiresIn: config.SIGNED_URL_SECONDS });
}
