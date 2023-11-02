import {
  S3Client,
  ListMultipartUploadsCommand,
  MultipartUpload,
  ListMultipartUploadsCommandInput,
  ListObjectsCommand,
  ListObjectsCommandInput,
  _Object,
} from "@aws-sdk/client-s3";
import { accessKeyId, endpoint, secretAccessKey } from "./environment.js";

// Set up s3
export const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${endpoint}`,
  credentials: { accessKeyId, secretAccessKey },
});

export async function listMultipartUploads(
  bucket: string
): Promise<MultipartUpload[]> {
  let isTruncated = false;
  let multipartUploads: MultipartUpload[] = new Array();
  const input: ListMultipartUploadsCommandInput = {
    Bucket: bucket,
  };
  do {
    const output = await s3.send(new ListMultipartUploadsCommand(input));
    isTruncated = output.IsTruncated ?? false;
    input.KeyMarker = output.NextKeyMarker;
    input.UploadIdMarker = output.NextUploadIdMarker;
    multipartUploads = multipartUploads.concat(output.Uploads ?? []);
  } while (isTruncated);
  return multipartUploads;
}
export async function listObjects(bucket: string): Promise<_Object[]> {
  let isTruncated = false;
  let objects: _Object[] = new Array();
  const input: ListObjectsCommandInput = {
    Bucket: bucket,
  };
  do {
    const output = await s3.send(new ListObjectsCommand(input));
    isTruncated = output.IsTruncated ?? false;
    input.Marker = output.NextMarker;
    objects = objects.concat(output.Contents ?? []);
  } while (isTruncated);
  return objects;
}
