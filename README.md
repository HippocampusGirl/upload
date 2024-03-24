### Generate private and public keys

```bash
openssl ecparam -genkey -name secp256k1 -noout -out private.key
openssl pkcs8 -topk8 -nocrypt -in private.key -out private.pem
openssl ec -in private.pem -pubout -out public.pem
```
