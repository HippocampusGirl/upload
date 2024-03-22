import { Column, Entity, ManyToOne, PrimaryColumn } from "typeorm";

import { Range } from "../utils/range.js";
import { File } from "./file.js";

import type { Relation } from "typeorm/common/RelationType.js";

@Entity()
export class Part {
  @PrimaryColumn("varchar")
  checksumMD5: string;

  @Column("bigint")
  start: number;
  @Column("bigint")
  end: number;

  @Column({ type: "boolean", default: false })
  complete: boolean;

  @ManyToOne(() => File, (file) => file.parts)
  file: Relation<File>;

  constructor({ checksumMD5, start, end, complete, file }: Partial<Part>) {
    this.checksumMD5 = checksumMD5!;
    this.start = start!;
    this.end = end!;
    this.complete = complete || false;
    this.file = file!;
  }

  get range(): Range {
    return new Range(this.start, this.end);
  }
}
