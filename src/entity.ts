import { Column, Entity, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";

import { S3ClientConfig } from "@aws-sdk/client-s3";

import { Range, reduceRanges } from "./utils/range.js";

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

@Entity()
export class StorageProvider {
  @PrimaryColumn("varchar")
  id: string;

  @Column("varchar")
  endpoint: string;
  @Column("varchar")
  region: string;
  @Column("varchar")
  accessKeyId: string;
  @Column("varchar")
  secretAccessKey: string;

  @Column("varchar", { nullable: true, default: null })
  bucketLocationConstraint: string | null;

  constructor({
    id,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucketLocationConstraint,
  }: Partial<Storage>) {
    this.id = id!;
    this.endpoint = endpoint!;
    this.region = region!;
    this.accessKeyId = accessKeyId!;
    this.secretAccessKey = secretAccessKey!;
    this.bucketLocationConstraint = bucketLocationConstraint || null;
  }

  get configuration(): S3ClientConfig {
    return {
      endpoint: this.endpoint,
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
    };
  }
}
