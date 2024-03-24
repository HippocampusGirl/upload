export const digest = async (
  value: string,
  algorithm: string = "SHA-256"
): Promise<string> => {
  // As per https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
  const buffer = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest({ name: algorithm }, buffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
