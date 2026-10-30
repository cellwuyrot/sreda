package ru.trioz.connect

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.amnezia.awg.crypto.Key
import org.amnezia.awg.crypto.KeyPair
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Curve25519 key encrypted with a non-exportable Android Keystore AES key. No JS private key. */
class VpnKeyStore(private val context: Context) {
    @Synchronized fun pair(account: String): KeyPair {
        require(account.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        val scope = java.security.MessageDigest.getInstance("SHA-256").digest(account.toByteArray()).joinToString("") { "%02x".format(it) }
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "trioz.vpn.key.v1"
        val secret = (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance("AES", "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generateKey()
        }
        val prefs = context.getSharedPreferences("vpn-key-$scope", Context.MODE_PRIVATE)
        val raw = prefs.getString("encrypted", null)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        if (raw != null) {
            val data = Base64.decode(raw, Base64.NO_WRAP)
            require(data.size > 28)
            cipher.init(Cipher.DECRYPT_MODE, secret, GCMParameterSpec(128, data.copyOfRange(0, 12)))
            return KeyPair(Key.fromBase64(String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8)))
        }
        val pair = KeyPair()
        cipher.init(Cipher.ENCRYPT_MODE, secret)
        val encrypted = cipher.iv + cipher.doFinal(pair.privateKey.toBase64().toByteArray(Charsets.UTF_8))
        check(prefs.edit().putString("encrypted", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
        return pair
    }
}
