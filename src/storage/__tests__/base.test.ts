import { StorageProvider } from "../../entity/storage-provider.js";

describe("storage", () => {
  it("can create download url from template", async () => {
    const storageProvider = new StorageProvider({
      id: "test",
      region: "does-not-matter",
      accessKeyId: "does-not-matter",
      secretAccessKey: "does-not-matter",
      endpoint: "does-not-matter",
      downloadUrlTemplate: "https://rainbows.puppies/file/{bucket}/{key}",
    });
    const storage = storageProvider.storage;
    const url = await storage.getDownloadUrl("upload-a-a", "a");
    expect(url).toBe("https://rainbows.puppies/file/upload-a-a/a");
  });
});
