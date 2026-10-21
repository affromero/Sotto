package fm.sotto.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import fm.sotto.app.model.*
import fm.sotto.app.storage.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class ProtectedStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun connection() = Connection("https://sotto.example", "a-unique-native-device-secret",
        Profile("private-profile", "Ada", false, "USER"))

    @Test fun encryptedRecoverySurvivesAStoreRestartWithoutPlaintextOnDisk() = runBlocking {
        val name = "test-${newID()}"
        val store = ProtectedStore(context, name)
        try {
            val connection = connection()
            val pending = PendingOperation(newID(), connection, "/api/v1/play/rooms", "{\"actionId\":\"original\"}", OperationResponse.ROOM)
            val safetyId = newID()
            val safety = PendingSafety(safetyId, connection, "/api/v1/play/rooms/room/reports",
                "{\"actionId\":\"$safetyId\",\"detail\":\"private report explanation\"}")
            store.update { it.copy(connection = connection, pending = pending, pendingSafety = safety,
                drafts = mapOf("draft" to "a private language draft")) }
            val bytes = File(context.noBackupFilesDir, "$name.enc").readBytes()
            assertFalse(bytes.toString(Charsets.UTF_8).contains(connection.token))
            assertFalse(bytes.toString(Charsets.UTF_8).contains("a private language draft"))
            assertFalse(bytes.toString(Charsets.UTF_8).contains("private report explanation"))
            val restored = ProtectedStore(context, name).load()
            assertEquals(connection, restored.connection)
            assertEquals(pending, restored.pending)
            assertEquals(safety, restored.pendingSafety)
            assertEquals("a private language draft", restored.drafts["draft"])
        } finally { store.erase() }
    }

    @Test fun concurrentDraftWritesPreserveEverySavedValue() = runBlocking {
        val name = "test-${newID()}"
        val store = ProtectedStore(context, name)
        try {
            coroutineScope {
                (1..24).map { index -> async(Dispatchers.IO) {
                    store.update { it.copy(drafts = it.drafts + ("round-$index" to "phrase-$index")) }
                } }.awaitAll()
            }
            val reloaded = ProtectedStore(context, name).load()
            for (index in 1..24) assertEquals("phrase-$index", reloaded.drafts["round-$index"])
        } finally { store.erase() }
    }

    @Test fun unreadableCiphertextIsPreservedAndCannotBeSilentlyOverwritten() = runBlocking {
        val name = "test-${newID()}"
        val store = ProtectedStore(context, name)
        try {
            store.update { it.copy(connection = connection()) }
            val file = File(context.noBackupFilesDir, "$name.enc")
            val original = file.readBytes()
            val damaged = original.clone().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
            file.writeBytes(damaged)
            val restarted = ProtectedStore(context, name)
            try { restarted.load(); fail("Damaged data must be refused") } catch (_: IllegalStateException) { }
            try { restarted.update { Vault() }; fail("Unreadable data must stay preserved") } catch (_: IllegalStateException) { }
            assertArrayEquals(damaged, file.readBytes())
            file.writeBytes(original)
            assertEquals(connection(), restarted.retryLoad().connection)
        } finally { store.erase() }
    }

    @Test fun failedAtomicRenameNeverReportsANewCredentialAsDurable() = runBlocking {
        val name = "test-${newID()}"
        val store = ProtectedStore(context, name)
        val file = File(context.noBackupFilesDir, "$name.enc")
        val backup = File(context.noBackupFilesDir, "$name.saved")
        val obstruction = File(file, "occupied")
        try {
            val before = store.update { it.copy(connection = connection(), drafts = mapOf("keep" to "original draft")) }
            check(file.renameTo(backup))
            check(file.mkdir())
            obstruction.writeText("Prevent replacement of this nonempty directory")
            try { store.update { it.copy(connection = connection().copy(token = "a-different-device-secret")) }; fail("An unverifiable rename must fail") }
            catch (_: java.io.IOException) { }
            catch (_: IllegalStateException) { }
            assertTrue(backup.isFile)
            check(obstruction.delete()); check(file.delete()); check(backup.renameTo(file))
            assertEquals(before, store.retryLoad())
        } finally {
            if (obstruction.exists()) obstruction.delete()
            if (file.isDirectory) file.delete()
            if (backup.exists() && !file.exists()) backup.renameTo(file)
            backup.delete()
            store.erase()
        }
    }
}
