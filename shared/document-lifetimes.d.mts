export class DocumentLifetimes {
  open(path: string): object;
  token(path: string): object | undefined;
  owns(path: string, token: object | undefined): boolean;
  close(path: string): void;
  clear(): void;
  rename(remap: (path: string) => string): void;
}
