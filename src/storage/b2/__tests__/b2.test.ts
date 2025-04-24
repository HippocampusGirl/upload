import undici, { Dispatcher } from "undici";

import { jest } from "@jest/globals";

import {
  authorizeAccount,
  AuthorizeAccountResponse,
} from "../authorize-account.js";
import {
  createBucket,
  defaultServerSideEncryption,
  keepOnlyLastVersion,
} from "../create-bucket.js";
import { deleteFileVersion } from "../delete-file.js";
import { headFileByName } from "../head-file-by-name.js";

describe("b2 api", () => {
  const accountId = "unicorns";
  const authorizationToken = "foo";
  const apiUrl = "https://foo";
  const downloadUrl = "https://baz";
  const authorizeAccountResponse: AuthorizeAccountResponse = {
    accountId,
    authorizationToken,
    apiInfo: { storageApi: { apiUrl, downloadUrl } },
  };
  it("can authorize account", async () => {
    const spy = jest.spyOn(undici, "request");
    const mockRequest: typeof undici.request<any> = async (url, options) => {
      expect(options).toBeDefined();
      expect(url).toMatchObject(
        new URL("https://api.backblazeb2.com/b2api/v3/b2_authorize_account")
      );
      const { method, headers } = options!;
      expect(method).toBe("GET");
      expect(headers).toMatchObject({
        Authorization: "Basic a2l0dGVuczpyYWluYm93cw==",
      });
      return {
        body: {
          json: async (): Promise<unknown> => ({
            accountId,
            authorizationToken,
            apiInfo: {
              storageApi: {
                apiUrl,
                downloadUrl,
                absoluteMinimumPartSize: 5000000,
                bucketId: null,
                bucketName: null,
                capabilities: [],
              },
            },
            downloadUrl: "https://bar",
          }),
        },
      } as unknown as Dispatcher.ResponseData;
    };
    spy.mockImplementationOnce(mockRequest);
    const applicationKeyId = "kittens";
    const applicationKey = "rainbows";
    const a = await authorizeAccount(applicationKeyId, applicationKey);
    expect(a).toMatchObject(authorizeAccountResponse);
    spy.mockRestore();
  });

  it("can create bucket", async () => {
    const bucketName = "bucket";

    const spy = jest.spyOn(undici, "request");
    const mockRequest: typeof undici.request<any> = async (url, options) => {
      expect(url).toMatchObject(new URL("b2api/v3/b2_create_bucket", apiUrl));
      expect(options).toBeDefined();
      const { method, headers, body } = options!;
      expect(method).toBe("POST");
      expect(headers).toMatchObject({
        Authorization: authorizationToken,
      });
      const json = JSON.parse(body as string);
      expect(json).toMatchObject({
        accountId,
        bucketName,
        bucketType: "allPrivate",
        bucketInfo: {},
        corsRules: [],
        fileLockEnabled: false,
        lifecycleRules: [keepOnlyLastVersion],
        replicationConfiguration: {},
        defaultServerSideEncryption,
      });
      return {
        body: {
          json: async (): Promise<unknown> => ({
            bucketId: "1234abcd",
            options: ["s3"],
          }),
        },
      } as unknown as Dispatcher.ResponseData;
    };
    spy.mockImplementationOnce(mockRequest);
    const c = await createBucket(authorizeAccountResponse, bucketName);
    expect(c).toMatchObject({
      options: ["s3"],
    });
    spy.mockRestore();
  });

  it("can head file by name", async () => {
    const bucketName = "bucket";
    const fileName = "file";
    const fileId = "puppies";
    const checksumSHA1 = "candy";

    const spy = jest.spyOn(undici, "request");
    const mockRequest: typeof undici.request<any> = async (url, options) => {
      expect(url).toMatchObject(new URL("file/bucket/file", apiUrl));
      const { method, headers } = options!;
      expect(method).toBe("HEAD");
      expect(headers).toMatchObject({
        Authorization: authorizationToken,
      });
      return {
        headers: {
          Server: "nginx",
          Date: "Thu, 1 Jan 1970 1:00:00 GMT",
          "Content-Type": "application/octet-stream",
          "Content-Length": "0",
          Connection: "keep-alive",
          "x-bz-file-name": "file",
          "x-bz-file-id": fileId,
          "x-bz-content-sha1": checksumSHA1,
          "X-Bz-Upload-Timestamp": "0",
          "Accept-Ranges": "bytes",
          "X-Bz-Server-Side-Encryption": "AES256",
          "Strict-Transport-Security": "max-age=63072000",
        },
      } as unknown as Dispatcher.ResponseData;
    };
    spy.mockImplementationOnce(mockRequest);
    const h = await headFileByName(
      authorizeAccountResponse,
      bucketName,
      fileName
    );
    expect(h).toMatchObject({
      fileName,
      fileId,
      checksumSHA1,
    });
    spy.mockRestore();
  });

  it("can delete by file id", async () => {
    const fileName = "file";
    const fileId = "puppies";
    const fileVersion = {
      fileName,
      fileId,
    };

    const spy = jest.spyOn(undici, "request");
    const mockRequest: typeof undici.request<any> = async (url, options) => {
      expect(url).toMatchObject(
        new URL("b2api/v3/b2_delete_file_version", apiUrl)
      );
      expect(options).toBeDefined();
      const { method, headers, body } = options!;
      expect(method).toBe("POST");
      expect(headers).toMatchObject({ Authorization: authorizationToken });
      const json = JSON.parse(body as string);
      expect(json).toMatchObject({ fileId });
      return {
        body: {
          json: async (): Promise<unknown> => fileVersion,
        },
      } as unknown as Dispatcher.ResponseData;
    };
    spy.mockImplementationOnce(mockRequest);
    const d = await deleteFileVersion(authorizeAccountResponse, fileVersion);
    expect(d).toMatchObject(fileVersion);
    spy.mockRestore();
  });
});
