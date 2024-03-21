import { _ClientSocket } from "../../socket.js";
import { UploadClient } from "../upload-client.js";

describe("upload-client", () => {
  let uploadClient: UploadClient;

  beforeAll(() => {
    uploadClient = new UploadClient(
      { disconnect: () => {} } as _ClientSocket,
      null,
      0,
      0
    );
  });
  afterAll(() => {
    uploadClient.terminate();
  });

  it("get correct relative paths without trailing slash", () => {
    uploadClient.basePath = "/work/data";
    expect(uploadClient.getRelativePath("/work/data/file")).toBe("file");
  });
  it("get correct relative paths with trailing slash", () => {
    uploadClient.basePath = "/work/data/";
    expect(uploadClient.getRelativePath("/work/data/file")).toBe("file");
  });
});
