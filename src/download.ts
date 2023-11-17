// import {
//   _Object,
//   DeleteObjectCommand,
//   ListBucketsCommand,
//   GetObjectCommand,
// } from "@aws-sdk/client-s3";
// import { signedUrlOptions, unpack } from "./base.ts";
// import { Joi, Segments, celebrate } from "celebrate";
// import { AuthenticationError } from "./errors.ts";
// import { NextFunction, Request, Response, Router } from "express";
// import { JwtPayload } from "jsonwebtoken";
// import { listObjects, s3 } from "./storage.ts";
// import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
// import { fileSchema, tokenSchema } from "./schema.ts";
// import { httpServer } from "./index.ts";
// import WebSocket from "ws";
// import { Server } from "socket.io";

// // export const download = Router();

// // io.use(async (socket, next) => {
// //   try {
// //     const { token } = socket.handshake.query;
// //     const verify = await jwt.verify(token, `${process.env.SECRET}`);

// //     const { _id } = verify as Token;

// //     socket.userId = _id;
// //     console.log(socket.userId);
// //     next();
// //   } catch (error) {
// //     console.log(error);
// //     next(new AuthenticationError("Invalid token"));
// //   }
// // });

// io.on("connection", (socket) => {
//   socket.on('authenticate', token => {
//     let decoded;

//     try {
//       decoded = jwt.verify(token, config.jwt.secret, {
//         algorithms: ['HS256'],
//         audience: config.hostedOn,
//         issuer: config.hostedOn,
//         clockTolerance: 30
//       }) as UserPayload;
//     } catch (err) {
//       socket.emit('unauthorized');
//       return;
//     }

//     // User is valid!
//     if (decoded) {
//       socket.decodedToken = decoded;
//       socket.emit('authorized');
//     }
// });

// // // Create downloads
// // download.get(
// //   "/file",
// //   celebrate({
// //     [Segments.BODY]: tokenSchema,
// //   }),
// //   unpack(
// //     async (
// //       request: Request,
// //       response: Response,
// //       next: NextFunction,
// //       payload: JwtPayload
// //     ) => {
// //       if (payload.type !== "download") {
// //         next(new AuthenticationError("Invalid token type"));
// //         return;
//       }
//       const buckets = await s3.send(new ListBucketsCommand({})).then((output) =>
//         output.Buckets?.reduce((previousValue, bucket) => {
//           if (bucket.Name?.startsWith("upload-")) {
//             previousValue.push(bucket.Name);
//           }
//           return previousValue;
//         }, new Array<string>())
//       );
//       if (buckets === undefined) {
//         return next(new Error("Not found"));
//       }
//       const urls = new Array<string>();
//       await Promise.all(
//         buckets.map(async (bucket) => {
//           const objects = await listObjects(bucket);
//           await Promise.all(
//             objects.map(async (object) => {
//               console.log(object);
//               const url = await getSignedUrl(
//                 s3,
//                 new GetObjectCommand({
//                   Bucket: bucket,
//                   Key: object.Key,
//                 }),
//                 signedUrlOptions
//               );
//               urls.push(url);
//             })
//           );
// //         })
// //       );
// //       return response.json(urls);
// //     }
// //   )
// // );
// // download.delete(
// //   "/file",
// //   celebrate({
// //     [Segments.BODY]: fileSchema.keys({
// //       Bucket: Joi.string().required(),
// //     }),
// //   }),
// //   unpack(
// //     async (
// //       request: Request,
// //       response: Response,
// //       next: NextFunction,
// //       payload: JwtPayload
// //     ) => {
// //       if (payload.type !== "download") {
// //         next(new AuthenticationError("Invalid token type"));
// //         return;
// //       }
// //       await s3.send(
// //         new DeleteObjectCommand({
// //           Bucket: request.body.Bucket,
// //           Key: request.body.Key,
// //         })
// //       );
// //       return response.json({});
// //     }
// //   )
// // );
