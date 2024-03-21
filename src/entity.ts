import { Column, Entity, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import type { Relation } from "typeorm/common/RelationType.js";

import { S3ClientConfig } from "@aws-sdk/client-s3";

import { Range, reduceRanges } from "./utils/range.js";

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

  @ManyToOne(() => StorageProvider, (storageProvider) => storageProvider.parts)
  storageProvider: Relation<StorageProvider>;

  constructor({
    checksumMD5,
    start,
    end,
    complete,
    file,
    storageProvider,
  }: Partial<Part>) {
    this.checksumMD5 = checksumMD5!;
    this.start = start!;
    this.end = end!;
    this.complete = complete || false;
    this.file = file!;
    this.storageProvider = storageProvider!;
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

  @Column({ type: "bigint", nullable: true, default: null })
  size: number | null;

  @Column({ type: "varchar", nullable: true, default: null })
  checksumSHA256: string | null;

  @Column({ type: "boolean", default: false })
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

  @OneToMany(() => Part, (part) => part.storageProvider)
  parts: Part[];

  constructor({
    id,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucketLocationConstraint,
    parts,
  }: Partial<Storage>) {
    this.id = id!;
    this.endpoint = endpoint!;
    this.region = region!;
    this.accessKeyId = accessKeyId!;
    this.secretAccessKey = secretAccessKey!;
    this.bucketLocationConstraint = bucketLocationConstraint || null;
    this.parts = parts || [];
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
