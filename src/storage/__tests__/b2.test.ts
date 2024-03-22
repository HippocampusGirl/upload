import { CancelableRequest, OptionsOfJSONResponseBody, Response } from "got";

import { jest } from "@jest/globals";

import { client } from "../../utils/http-client.js";
import {
    authorizeAccount, AuthorizeAccountResponse, createBucket, defaultServerSideEncryption,
    keepOnlyLastVersion
} from "../b2.js";

describe("b2 api", () => {
  const accountId = "unicorns";
  const authorizationToken = "foo";
  const apiUrl = "https://foo";
  const authorizeAccountResponse: AuthorizeAccountResponse = {
    accountId,
    authorizationToken,
    apiInfo: { storageApi: { apiUrl } },
  };
  it("can authorize account", async () => {
    const spy = jest.spyOn(client, "get");
    spy.mockImplementationOnce(
      (o: unknown): CancelableRequest<Response<unknown>> => {
        const options = o as OptionsOfJSONResponseBody;
        expect(options.url).toMatchObject(
          new URL("https://api.backblazeb2.com/b2api/v3/b2_authorize_account")
        );
        expect(options.headers).toMatchObject({
          Authorization: "Basic a2l0dGVuczpyYWluYm93cw==",
        });
        return new Promise((resolve) => {
          resolve({
            body: {
              accountId,
              authorizationToken,
              apiInfo: {
                storageApi: {
                  apiUrl,
                  absoluteMinimumPartSize: 5000000,
                  bucketId: null,
                  bucketName: null,
                  capabilities: [],
                },
              },
              downloadUrl: "https://bar",
            },
          });
        }) as unknown as CancelableRequest<Response<unknown>>;
      }
    );
    const applicationKeyId = "kittens";
    const applicationKey = "rainbows";
    const a = await authorizeAccount(applicationKeyId, applicationKey);
    expect(a).toMatchObject(authorizeAccountResponse);
    spy.mockRestore();
  });

  it("can create bucket", async () => {
    const bucketName = "bucket";

    const spy = jest.spyOn(client, "post");
    spy.mockImplementationOnce(
      (o: unknown): CancelableRequest<Response<unknown>> => {
        const options = o as OptionsOfJSONResponseBody;
        expect(options.url).toMatchObject(
          new URL("b2api/v3/b2_create_bucket", apiUrl)
        );
        expect(options.headers).toMatchObject({
          Authorization: authorizationToken,
        });
        expect(options.json).toMatchObject({
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
        return new Promise((resolve) => {
          resolve({
            body: {
              bucketId: "1234abcd",
              options: ["s3"],
            },
          });
        }) as unknown as CancelableRequest<Response<unknown>>;
      }
    );
    const c = await createBucket(authorizeAccountResponse, bucketName);
    expect(c).toMatchObject({
      options: ["s3"],
    });
    spy.mockRestore();
  });
});
