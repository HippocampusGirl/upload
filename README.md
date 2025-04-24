### Generate private and public keys

```bash
openssl ecparam -genkey -name prime256v1 -out private.key
openssl pkcs8 -topk8 -nocrypt -in private.key -out private.pem
openssl ec -in private.pem -pubout -out public.pem
```

### Run locally

```bash
node --import @swc-node/register/esm-register src/index.ts create-token --private-key-file private.pem --type upload --storage-id r2weur --name test
```
