export const getDownloadUrl = (
  downloadUrl: string,
  bucket: string,
  fileName: string,
  authorizationToken: string
): string => {
  const url = new URL(`/file/${bucket}/${fileName}`, downloadUrl);
  url.searchParams.set("Authorization", authorizationToken);
  return url.toString();
};
