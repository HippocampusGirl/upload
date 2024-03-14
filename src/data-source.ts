import { DataSource } from "typeorm";

import { File, Part } from "./entity.js";

export const dataSource = new DataSource({
  type: "sqlite",
  database: "upload.sqlite",
  logging: true,
  synchronize: true,
  entities: [File, Part],
  subscribers: [],
  migrations: [],
  entitySkipConstructor: true,
});
