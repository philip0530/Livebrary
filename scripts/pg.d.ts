declare module 'pg' {
  type QueryResult = { rowCount: number | null; rows: unknown[] }
  class Client {
    constructor(config: { host: string; port: number; user: string; password: string; database: string; connectionTimeoutMillis?: number })
    connect(): Promise<void>
    query(text: string): Promise<QueryResult>
    end(): Promise<void>
  }
  const pg: { Client: typeof Client }
  export default pg
}
