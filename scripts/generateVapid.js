'use strict';
// Prints a fresh pair of push-notification keys. Run once:  npm run vapid
// Put the two values in Railway → Variables, then redeploy. Keep the private key secret.
const crypto = require('crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const b64 = (b) => Buffer.from(b).toString('base64url');
const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
const rawPub = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
console.log('\nVAPID_PUBLIC_KEY=' + b64(rawPub));
console.log('VAPID_PRIVATE_KEY=' + priv.d);
console.log('VAPID_SUBJECT=mailto:Alfijeershops@gmail.com\n');
