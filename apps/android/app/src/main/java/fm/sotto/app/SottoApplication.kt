package fm.sotto.app

import android.app.Application
import fm.sotto.app.storage.ProtectedStore
import fm.sotto.app.network.NetworkAccess

class SottoApplication : Application() {
    override fun onCreate() { super.onCreate(); NetworkAccess.initialize(this) }
    val protectedStore: ProtectedStore by lazy { ProtectedStore(this) }
}
