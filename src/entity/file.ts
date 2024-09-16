import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from "typeorm";

import { Part } from "./part.js";

@Entity("files")
@Index(["n", "path"], { unique: true })
export class File {
  @PrimaryGeneratedColumn("increment", { type: "integer" })
  id: number;

  @Column({ type: "varchar" })
  n: string;
  @Column({ type: "varchar" })
  path: string;

  @Column({ type: "bigint", nullable: true, default: null })
  size: number | null;

  @Column({
    name: "checksum_sha256",
    type: "varchar",
    nullable: true,
    default: null,
  })
  checksumSHA256: string | null;

  @Column({ type: "boolean", default: false })
  verified: boolean;

  @OneToMany(() => Part, (part: Part) => part.file)
  parts: Promise<Part[]>;
}
