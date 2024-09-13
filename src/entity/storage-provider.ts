import { Column, Entity, PrimaryColumn } from "typeorm";

import { S3Client } from "@aws-sdk/client-s3";

import { B2Storage } from "../storage/b2/base.js";
import { _StorageProvider, Storage } from "../storage/base.js";
import { S3Storage } from "../storage/s3.js";

@Entity("storage_providers")
export class StorageProvider implements _StorageProvider {
  @PrimaryColumn("varchar")
  id: string;

  @Column("varchar")
  endpoint: string;
  @Column("varchar")
  region: string;
  @Column({ name: "access_key_id", type: "varchar" })
  accessKeyId: string;
  @Column({ type: "varchar" })
  secretAccessKey: string;

  @Column({ type: "varchar", nullable: true, default: null })
  bucketLocationConstraint: string | null;
  @Column({ type: "varchar", nullable: true, default: null })
  downloadUrlTemplate: string | null;

  constructor({
    id,
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucketLocationConstraint,
    downloadUrlTemplate,
  }: Partial<StorageProvider>) {
    this.id = id!;
    this.endpoint = endpoint!;
    this.region = region!;
    this.accessKeyId = accessKeyId!;
    this.secretAccessKey = secretAccessKey!;
    this.bucketLocationConstraint = bucketLocationConstraint || null;
    this.downloadUrlTemplate = downloadUrlTemplate || null;
  }

  get s3(): S3Client {
    return new S3Client({
      forcePathStyle: true,
      endpoint: this.endpoint,
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
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
