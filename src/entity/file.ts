import { Column, Entity, OneToMany, PrimaryColumn } from "typeorm";

import { reduceRanges } from "../utils/range.js";
import { Part } from "./part.js";

@Entity()
export class File {
  @PrimaryColumn()
  n: string;
  @PrimaryColumn()
  path: string;

  @Column({ type: "bigint", nullable: true, default: null })
  size: number | null;

  @Column({ type: "varchar", nullable: true, default: null })
  checksumSHA256: string | null;

  @Column({ type: "boolean", default: false })
  verified: boolean;

  @OneToMany(() => Part, (part) => part.file)
  parts: Part[];

  /**
   * Creates a new instance of the File class.
   * @param n - The name of the token that the file was uploaded from.
   * @param path - The path of the file.
   * @param parts - The parts of the file.
   * @param size - The size of the file.
   * @param verified - Indicates if the file is verified.
   * @param checksumSHA256 - The SHA256 checksum of the file.
   */
  constructor({
    n,
    path,
    parts,
    size,
    verified,
    checksumSHA256,
  }: Partial<File>) {
    this.n = n!;
    this.path = path!;
    this.size = size || null;
    this.verified = verified || false;
    this.checksumSHA256 = checksumSHA256 || null;
    this.parts = parts || [];
  }

  get complete(): boolean {
    if (this.size === undefined || this.checksumSHA256 === undefined) {
      return false;
    }
    if (!this.parts) {
      return false;
    }
    const ranges = reduceRanges(
      this.parts.filter(({ complete }) => complete).map(({ range }) => range)
    );
    const range = ranges[0];
    if (range === undefined) {
      return false;
    }
    const { start } = range;
    const complete = start == 0 && range.size() == this.size;
    return complete;
  }
}
