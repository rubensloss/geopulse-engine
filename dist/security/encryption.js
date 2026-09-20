import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
/**
 * Obtém ou deriva a chave de 32 bytes a partir da variável de ambiente ENCRYPTION_KEY.
 * Se não estiver configurada, gera um aviso e deriva de um fallback seguro em desenvolvimento.
 */
function getMasterKey() {
    const secret = process.env.ENCRYPTION_KEY || 'default-dev-secret-key-change-in-production-32b';
    // Garante exatamente 32 bytes através de SHA-256
    return crypto.createHash('sha256').update(secret).digest();
}
/**
 * Criptografa credenciais sensíveis (senhas do WordPress, tokens de API do Webflow, etc.)
 * usando AES-256-GCM (padrão de segurança bancária com verificação de integridade).
 *
 * @param plaintext Texto puro ou objeto JSON serializado
 * @returns String no formato "iv:authTag:ciphertext" codificada em hexadecimal
 */
export function encryptCredential(plaintext) {
    const masterKey = getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    // Retorna iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}
/**
 * Descriptografa e valida a integridade dos dados protegidos.
 * Lança erro se o dado tiver sido corrompido ou adulterado.
 */
export function decryptCredential(encryptedPayload) {
    const parts = encryptedPayload.split(':');
    if (parts.length !== 3) {
        throw new Error('Formato de carga criptografada inválido. Esperado "iv:authTag:ciphertext".');
    }
    const [ivHex, authTagHex, cipherTextHex] = parts;
    const masterKey = getMasterKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(cipherTextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
/**
 * Utilitário para criptografar objetos inteiros de credenciais (ex: { username, applicationPassword })
 */
export function encryptJsonCredential(credentialObj) {
    return encryptCredential(JSON.stringify(credentialObj));
}
/**
 * Utilitário para descriptografar e retornar o objeto tipado
 */
export function decryptJsonCredential(encryptedPayload) {
    const decrypted = decryptCredential(encryptedPayload);
    return JSON.parse(decrypted);
}
