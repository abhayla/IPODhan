# Data Security Configuration

## Encryption at Rest

```terraform
# infrastructure/terraform/encryption.tf

# RDS Encryption
resource "aws_db_instance" "main" {
  identifier     = "ipodhan-db"
  engine         = "postgres"
  engine_version = "15.3"

  # Encryption at rest
  storage_encrypted = true
  kms_key_id       = aws_kms_key.rds.arn

  # Backup encryption
  backup_retention_period = 30
  backup_window          = "03:00-04:00"

  # Security settings
  deletion_protection = true
  skip_final_snapshot = false

  tags = {
    Name = "ipodhan-main-db"
  }
}

# S3 Bucket Encryption
resource "aws_s3_bucket" "documents" {
  bucket = "ipodhan-documents"

  tags = {
    Name = "ipodhan-documents"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# KMS Keys
resource "aws_kms_key" "rds" {
  description             = "KMS key for RDS encryption"
  deletion_window_in_days = 10
  enable_key_rotation     = true

  tags = {
    Name = "ipodhan-rds-key"
  }
}

resource "aws_kms_key" "s3" {
  description             = "KMS key for S3 encryption"
  deletion_window_in_days = 10
  enable_key_rotation     = true

  tags = {
    Name = "ipodhan-s3-key"
  }
}
```

## Encryption in Transit

```typescript
// config/tls.ts
import fs from 'fs';
import https from 'https';

export const tlsConfig = {
  cert: fs.readFileSync('/etc/ssl/certs/ipodhan.crt'),
  key: fs.readFileSync('/etc/ssl/private/ipodhan.key'),
  ca: fs.readFileSync('/etc/ssl/certs/ca-bundle.crt'),

  // Enforce TLS 1.2 minimum
  secureProtocol: 'TLSv1_2_method',

  // Strong cipher suites only
  ciphers: [
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-SHA256',
    'ECDHE-RSA-AES256-SHA384'
  ].join(':'),

  honorCipherOrder: true
};

// Database SSL connection
export const dbConfig = {
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/etc/ssl/certs/rds-ca-2019-root.pem')
  }
};
```
