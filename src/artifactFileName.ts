// Result names may be virtual relative paths. Saving a copy uses a leaf name;
// the original name remains on the artifact for previews and its data directory.
export function artifactFileName(name: string): string {
  return name.split(/[\\/]/).pop() || name;
}

export const validArtifactFileName = (name: string) =>
  !!name && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && name.length <= 200
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
