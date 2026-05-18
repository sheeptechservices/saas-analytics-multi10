import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET
  if (!secret) throw new Error('ENCRYPTION_SECRET environment variable is not set')
  const buf = Buffer.from(secret, 'hex')
  if (buf.length !== 32) throw new Error('ENCRYPTION_SECRET must be 64 hex characters (32 bytes)')
  return buf
}

export function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(text: string): string {
  const parts = text.split(':')
  if (parts.length !== 3) return text
  const [ivHex, authTagHex, ciphertextHex] = parts
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8')
}
