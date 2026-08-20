-- FIX-VAULTPW: пароль «Сейфа» в личных сообщениях (bcrypt-хеш).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "vaultPasswordHash" TEXT;
