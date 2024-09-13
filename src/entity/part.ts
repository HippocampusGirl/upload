import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";

import { Range } from "../utils/range.js";
import { File } from "./file.js";

import type { Relation } from "typeorm/common/RelationType.js";

@Entity("parts")
@Index(["checksumMD5"], { unique: true })
export class Part {
  @PrimaryColumn("bigint")
  start: number;
  @PrimaryColumn("bigint")
  end: number;

  @Column({ type: "boolean", default: false })
  complete: boolean;

  @PrimaryColumn({ name: "file_id", type: "number" })
  file_id: number;

  @JoinColumn({ name: "file_id" })
  @ManyToOne(() => File, (file) => file.parts)
  file: Relation<File>;

  @Column({ name: "checksum_md5", type: "varchar" })
  checksumMD5: string;

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
