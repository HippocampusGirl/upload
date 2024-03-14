import { Column, Entity, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";

import { Range } from "./utils/range.js";

@Entity()
export class Part {
  @PrimaryColumn()
  checksumMD5: string;

  @Column()
  start: number;
  @Column()
  end: number;

  @Column({ default: false })
  complete: boolean;

  @ManyToOne(() => File, (file) => file.parts)
  file: File;

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

@Entity()
export class File {
  @PrimaryColumn()
  bucket: string;
  @PrimaryColumn()
  path: string;

  @Column({ nullable: true, default: null })
  size: number | null;

  @Column({ nullable: true, default: null })
  checksumSHA256: string | null;

  @Column({ default: false })
  verified: boolean;

  @OneToMany(() => Part, (part) => part.file)
  parts: Part[];

  constructor({
    bucket,
    path,
    parts,
    size,
    verified,
    checksumSHA256,
  }: Partial<File>) {
    this.bucket = bucket!;
    this.path = path!;
    this.size = size || null;
    this.verified = verified || false;
    this.checksumSHA256 = checksumSHA256 || null;
    this.parts = parts || new Array();
  }
}
