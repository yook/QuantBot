declare module '../db/secret-store.cjs' {
  export const MK_PATH: string;
  export function ensureMasterKeyExists(): Buffer;
  export function readMasterKey(): Buffer | null;
  export function encryptWithMk(mkBuffer: Buffer, plaintext: string): string;
  export function decryptWithMk(mkBuffer: Buffer, payloadJson: string): string;
  export function saveSecret(keyName: string, plaintext: string): Promise<boolean>;
  export function getSecret(keyName: string): Promise<string | null>;
  export function deleteSecret(keyName: string): Promise<boolean>;
  export function migrateFromKeytar(keytar: any, service: string, account: string): Promise<any>;
}

declare module 'electron/db/secret-store.cjs' {
  export const MK_PATH: string;
  export function ensureMasterKeyExists(): Buffer;
  export function readMasterKey(): Buffer | null;
  export function encryptWithMk(mkBuffer: Buffer, plaintext: string): string;
  export function decryptWithMk(mkBuffer: Buffer, payloadJson: string): string;
  export function saveSecret(keyName: string, plaintext: string): Promise<boolean>;
  export function getSecret(keyName: string): Promise<string | null>;
  export function deleteSecret(keyName: string): Promise<boolean>;
  export function migrateFromKeytar(keytar: any, service: string, account: string): Promise<any>;
}
