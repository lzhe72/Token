import fs from 'node:fs';
import path from 'node:path';

export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class TrustedDeviceStore {
  private readonly file: string;

  constructor(directory: string, private readonly cipher: SecretCipher) {
    this.file = path.join(directory, 'trusted-device.secret');
  }

  read(): string | null {
    if (!fs.existsSync(this.file)) return null;
    if (!this.cipher.isEncryptionAvailable()) return null;
    try {
      const token = this.cipher.decryptString(fs.readFileSync(this.file));
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('受信凭证损坏');
      return token;
    } catch {
      this.clear();
      return null;
    }
  }

  write(token: string): void {
    if (!this.cipher.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法信任此设备');
    const temp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temp, this.cipher.encryptString(token), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    fs.chmodSync(this.file, 0o600);
  }

  clear(): void {
    try { fs.unlinkSync(this.file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
