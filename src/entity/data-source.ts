import betterSqlite3 from "better-sqlite3";
import Debug from "debug";
import pg from "pg";
import { DataSource } from "typeorm";

import { File } from "./file.js";
import { Part } from "./part.js";
import { StorageProvider } from "./storage-provider.js";

const debug = Debug("entity");

export type DatabaseType = "sqlite" | "postgres";
export const getDataSource = async (
  type: DatabaseType,
  connectionString: string,
  logging: boolean = false,
  subscribers: Function[] = []
): Promise<DataSource> => {
  const config = {
    logging,
    synchronize: false,
    entities: [File, Part, StorageProvider],
    subscribers,
    migrations: [],
    entitySkipConstructor: true,
    cache: false,
  };
  debug("connecting to %o database at %o", type, connectionString);
  let dataSource: DataSource;
  switch (type) {
    case "sqlite":
      dataSource = await new DataSource({
        type: "better-sqlite3",
        driver: betterSqlite3,
        database: connectionString,
        enableWAL: true,
        logger: "debug",
        ...config,
      }).initialize();

      // Run a query to ensure that the database is writable
      await dataSource.manager.query("pragma user_version=0");

      return dataSource;
    case "postgres":
      return new DataSource({
        type: "postgres",
        driver: pg,
        url: connectionString,
        parseInt8: true,
        logger: "debug",
        ...config,
      }).initialize();
    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
};
