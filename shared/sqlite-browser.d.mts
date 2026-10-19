export interface DatabaseObject {
  type: string;
  name: string;
  table: string;
  sql: string;
  system: boolean;
}
export interface QueryPage {
  columns: string[];
  rows: string[][];
  more: boolean;
  page: number;
}
export function objectQuery(object: DatabaseObject): string;
export function sqliteBrowser(
  db: any,
): {
  catalog(): { objects: DatabaseObject[]; metadata: Record<string, unknown> };
  query(sql: string, page?: number): QueryPage;
  objectQuery(object: DatabaseObject): string;
};
