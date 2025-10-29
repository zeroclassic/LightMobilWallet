import { ec as EC } from "elliptic";
import { sha256 } from "js-sha256";
import RIPEMD160 from "ripemd160";
import bs58 from "bs58";

const ec = new EC("secp256k1");

// === Random Private Key (compatible RN) ===
export function randomPrivKey(): string {
  const n = ec.curve.n; // ordre du groupe
  let priv: bigint;

  do {
    const bytes = new Uint8Array(32);
    // Remplit avec des octets aléatoires
    crypto.getRandomValues(bytes);
    priv = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  } while (priv === 0n || priv >= n); // doit être < n et > 0

  return Buffer.from(priv.toString(16).padStart(64, "0"), "hex").toString("hex");
}

// === hash160 = RIPEMD160(SHA256(data)) ===
function hash160(buf: Buffer): Buffer {
  const sha = Buffer.from(sha256.array(buf));
  const ripe = new RIPEMD160().update(sha).digest();
  return ripe;
}

// === Base58Check encoding (prefix + payload + checksum) ===
function base58Check(prefix: Buffer, payload: Buffer): string {
  const data = Buffer.concat([prefix, payload]);
  const first = Buffer.from(sha256.array(data));
  const second = Buffer.from(sha256.array(first));
  const checksum = second.subarray(0, 4);
  return bs58.encode(Buffer.concat([data, checksum]));
}

// === Génération taddr + WIF compressé ===
export function generateZercKeysRN(privKeyHex: string): { taddr: string; wif: string } {
  const privKey = Buffer.from(privKeyHex, "hex");
  if (privKey.length !== 32) {
    throw new Error("privKeyHex doit faire 32 octets (64 hex).");
  }

  // Pubkey compressée à partir de privkey
  const kp = ec.keyFromPrivate(privKeyHex);
  const pubkeyCompressed = Buffer.from(kp.getPublic(true, "array"));

  // --- taddr (prefix 0x1C,0xB8) ---
  const taddrPrefix = Buffer.from([0x1c, 0xb8]);
  const taddr = base58Check(taddrPrefix, hash160(pubkeyCompressed));

  // --- WIF compressé (prefix 0x80 + privKey + 0x01) ---
  const wifPrefix = Buffer.from([0x80]);
  const extended = Buffer.concat([wifPrefix, privKey, Buffer.from([0x01])]);
  const first = Buffer.from(sha256.array(extended));
  const second = Buffer.from(sha256.array(first));
  const wifChecksum = second.subarray(0, 4);
  const wif = bs58.encode(Buffer.concat([extended, wifChecksum]));

  return { taddr, wif };
}
