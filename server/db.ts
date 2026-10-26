export type SqlValue = string | number | null;
export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}
export interface MutationResult {
  changes: number;
}
export interface Database {
  query<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  run(sql: string, params?: SqlValue[]): Promise<MutationResult>;
  batch(statements: SqlStatement[]): Promise<MutationResult[]>;
}
