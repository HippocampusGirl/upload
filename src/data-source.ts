import Debug from "debug";
import { DataSource } from "typeorm";

import { File, Part } from "./entity.js";

const debug = Debug("data-source");
export const getDataSource = (
  type: "sqlite" | "postgres",
  url: string,
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
  debug("connecting to %o database at %o", type, url);
  switch (type) {
    case "sqlite":
      return new DataSource({
        type: "sqlite",
        database: url,
        ...config,
      }).initialize();
    case "postgres":
      return new DataSource({
        type: "postgres",
        url,
        ...config,
      }).initialize();
    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
};
