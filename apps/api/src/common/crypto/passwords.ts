import { hash, verify } from "@node-rs/argon2";

/** argon2id (the library default) with its own random salt; the encoded hash carries parameters and salt. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** False for a wrong password and for any stored value that is not a valid argon2 hash (e.g. seed placeholders). */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
