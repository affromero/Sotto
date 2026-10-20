package fm.sotto.app.storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.system.Os
import android.system.OsConstants
import fm.sotto.app.model.SottoJson
import fm.sotto.app.io.readBounded
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class ProtectedStore(context: Context, name: String = "partner-play-v1") : VaultPersistence {
    private val file = AtomicFile(File(context.noBackupFilesDir, "$name.enc"))
    private val alias = "${context.packageName}.$name"
    private val aad = alias.toByteArray(Charsets.UTF_8)
    private val mutex = Mutex()
    private var loaded: Vault? = null
    private var loadFailed = false

    override suspend fun load(): Vault = withContext(Dispatchers.IO) {
        mutex.withLock { read() }
    }

    override suspend fun update(transform: (Vault) -> Vault): Vault = withContext(Dispatchers.IO) {
        mutex.withLock {
            val before = read()
            val next = transform(before).copy(serial = Math.addExact(before.serial, 1))
            next.validate()
            val plain = SottoJson.encodeToString(next).toByteArray(Charsets.UTF_8)
            require(plain.size <= MAX_BYTES) { "Saved game data is full. Remove an old connection or draft." }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key(create = !file.baseFile.exists()))
            cipher.updateAAD(aad)
            val encoded = byteArrayOf(1) + cipher.iv + cipher.doFinal(plain)
            val output = file.startWrite()
            try {
                output.write(encoded)
                output.fd.sync()
                file.finishWrite(output)
                val directory = Os.open(requireNotNull(file.baseFile.parent),
                    OsConstants.O_RDONLY, 0)
                try { Os.fsync(directory) } finally { Os.close(directory) }
                val committed = file.baseFile.inputStream().use { it.readBounded(MAX_BYTES + 29) }
                check(committed.contentEquals(encoded)) { "The saved credential could not be verified on disk." }
            } catch (error: Exception) {
                file.failWrite(output)
                loaded = null
                loadFailed = true
                throw error
            }
            loaded = next
            next
        }
    }

    override suspend fun erase() = withContext(Dispatchers.IO) {
        mutex.withLock {
            file.delete()
            check(!file.baseFile.exists()) { "Saved data could not be removed." }
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            store.deleteEntry(alias)
            loaded = Vault()
            loadFailed = false
        }
    }

    private fun read(): Vault {
        check(!loadFailed) { "Saved game data could not be read. It is preserved. Retry or explicitly erase it." }
        loaded?.let { return it }
        try {
            val encoded = try {
                file.openRead().use { it.readBounded(MAX_BYTES + 29) }
            } catch (error: java.io.FileNotFoundException) {
                if (file.baseFile.exists()) throw error
                return Vault().also { loaded = it }
            }
            require(encoded.size in 30..(MAX_BYTES + 29) && encoded[0] == 1.toByte())
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, encoded.copyOfRange(1, 13)))
            cipher.updateAAD(aad)
            val plain = cipher.doFinal(encoded.copyOfRange(13, encoded.size))
            val value = SottoJson.decodeFromString<Vault>(plain.toString(Charsets.UTF_8))
            value.validate()
            loaded = value
            return value
        } catch (error: Exception) {
            loadFailed = true
            throw IllegalStateException("Saved game data could not be read safely. It has been preserved.", error)
        }
    }

    override suspend fun retryLoad(): Vault = withContext(Dispatchers.IO) {
        mutex.withLock { loadFailed = false; loaded = null; read() }
    }

    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        check(create) { "The encryption key is unavailable. Saved data has been preserved." }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }

    companion object { const val MAX_BYTES = 262_144 }
}
