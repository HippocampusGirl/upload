import Debug from "debug";
import { DataSource } from "typeorm";
import pg from "pg";
import betterSqlite3 from "better-sqlite3";

import { File, Part } from "./entity.js";

const debug = Debug("data-source");
export const getDataSource = async (
  type: "sqlite" | "postgres",
  connectionString: string,
  logging: boolean = false
): Promise<DataSource> => {
  const config = {
    logging,
    synchronize: false,
    entities: [File, Part],
    subscribers: [],
    migrations: [],
    entitySkipConstructor: true,
  };
  debug("connecting to %o database at %o", type, connectionString);
  let dataSource: DataSource;
  switch (type) {
    case "sqlite":
      dataSource = await new DataSource({
        type: "better-sqlite3",
        driver: betterSqlite3,
        database: connectionString,
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
        ...config,
      }).initialize();
    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
};