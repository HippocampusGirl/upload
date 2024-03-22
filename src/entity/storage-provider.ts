import { Column, Entity, PrimaryColumn } from "typeorm";

import { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";

import { B2Storage } from "../storage/b2/base.js";
import { Storage } from "../storage/base.js";
import { S3Storage } from "../storage/s3.js";

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
  @Column("varchar", { nullable: true, default: null })
  backblazeDownloadUrl: string | null;

  constructor({
    id,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucketLocationConstraint,
    backblazeDownloadUrl,
  }: Partial<StorageProvider>) {
    this.id = id!;
    this.endpoint = endpoint!;
    this.region = region!;
    this.accessKeyId = accessKeyId!;
    this.secretAccessKey = secretAccessKey!;
    this.bucketLocationConstraint = bucketLocationConstraint || null;
    this.backblazeDownloadUrl = backblazeDownloadUrl || null;
  }

  get s3Configuration(): S3ClientConfig {
    return {
      endpoint: this.endpoint,
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
    };
  }

  get s3(): S3Client {
    return new S3Client({
      forcePathStyle: true,
      ...this.s3Configuration,
    });
  }

  get isBackblaze(): boolean {
    return this.endpoint.endsWith("backblazeb2.com");
  }

  get storage(): Storage {
    if (this.isBackblaze) {
      return new B2Storage(this);
    }
    return new S3Storage(this);
  }
}
