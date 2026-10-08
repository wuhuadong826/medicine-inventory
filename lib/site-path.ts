const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";

export const basePath = rawBasePath && rawBasePath !== "/"
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

export function withBasePath(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${basePath}${normalizedPath}`;
}
