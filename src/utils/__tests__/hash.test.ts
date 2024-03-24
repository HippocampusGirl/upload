import { createHash } from "node:crypto";

import { digest } from "../hash.js";

test("can calculate sha256 hash", async () => {
  const value = "foobar";

  const nodeDigest = createHash("sha256").update(value, "utf8").digest("hex");
  const subtleDigest = await digest(value);

  expect(subtleDigest).toBe(nodeDigest);
});
