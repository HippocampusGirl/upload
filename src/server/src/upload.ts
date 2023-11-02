import { signedUrlOptions, unpack } from "./base.js";
import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  _Object,
} from "@aws-sdk/client-s3";
import { Joi, Segments, celebrate } from "celebrate";
import { AuthenticationError } from "./errors.js";
import { NextFunction, Request, Response, Router } from "express";
import { JwtPayload } from "jsonwebtoken";
import { listMultipartUploads, s3 } from "./storage.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { fileSchema } from "./schema.js";

export const upload = Router();

// Create uploads
interface Input {
  Bucket: string;
  Key: string;
}
function createInput(
  request: Request,
  next: NextFunction,
  payload: JwtPayload
): Input | undefined {
  if (payload.type !== "upload") {
    next(new AuthenticationError("Invalid token type"));
    return;
  }
  const bucket = `upload-${payload.name}`;
  return {
    Bucket: bucket,
    Key: request.body.Key,
  };
}

upload.post(
  "/file/create",
  celebrate({
    [Segments.BODY]: fileSchema.keys({
      PartCount: Joi.number().integer().min(1).max(10000).required(),
    }),
  }),
  unpack(
    async (
      request: Request,
      response: Response,
      next: NextFunction,
      payload: JwtPayload
    ) => {
      const input = createInput(request, next, payload);
      if (input === undefined) {
        return;
      }

      // Create bucket if it doesn't exist
      const bucketInput = { Bucket: input.Bucket };
      await s3.send(new HeadBucketCommand(bucketInput)).catch(async () => {
        await s3.send(new CreateBucketCommand(bucketInput));
      });

      // Delete existing multipart uploads
      const multipartUploads = await listMultipartUploads(input.Bucket);
      multipartUploads
        .filter((upload) => upload.Key === input.Key)
        .forEach((upload) => {
          s3.send(
            new AbortMultipartUploadCommand({
              ...input,
              UploadId: upload.UploadId,
            })
          );
        });

      // Create multipart upload
      const { UploadId } = await s3.send(
        new CreateMultipartUploadCommand(input)
      );
      const partCount = request.body.PartCount as number;
      const parts = [...Array(partCount).keys()];
      const urls: string[] = await Promise.all(
        parts.map((i) =>
          getSignedUrl(
            s3,
            new UploadPartCommand({
              ...input,
              UploadId,
              PartNumber: i + 1,
            }),
            signedUrlOptions
          )
        )
      );
      return response.json(urls);
    }
  )
);
const completedPartSchema = Joi.object().keys({
  PartNumber: Joi.number().integer().min(1).required(),
  ETag: Joi.string().required(),
  ChecksumSHA256: Joi.string().required(),
});
upload.post(
  "/file/complete",
  celebrate({
    [Segments.BODY]: fileSchema.keys({
      Parts: Joi.array().items(completedPartSchema).required(),
    }),
  }),
  unpack(
    async (
      request: Request,
      response: Response,
      next: NextFunction,
      payload: JwtPayload
    ) => {
      const input = createInput(request, next, payload);
      if (input === undefined) {
        return;
      }
      const multipartUploads = await listMultipartUploads(input.Bucket);
      const multipartUpload = multipartUploads.find(
        (upload) => upload.Key === input.Key
      );
      if (multipartUpload === undefined) {
        return next(new Error("Not found"));
      }
      await s3.send(
        new CompleteMultipartUploadCommand({
          ...input,
          UploadId: multipartUpload.UploadId,
          MultipartUpload: {
            Parts: request.body.Parts,
          },
        })
      );
      return response.json({});
    }
  )
);
