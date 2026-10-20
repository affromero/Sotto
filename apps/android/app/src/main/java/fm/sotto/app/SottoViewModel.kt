package fm.sotto.app

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import fm.sotto.app.model.PlayInvitation
import fm.sotto.app.play.PlayCoordinator
import fm.sotto.app.play.setForeground
import kotlinx.coroutines.launch

class SottoViewModel(application: Application) : AndroidViewModel(application) {
    val play = PlayCoordinator((application as SottoApplication).protectedStore, viewModelScope,
        "${Build.MANUFACTURER} ${Build.MODEL}".take(80))

    fun openLink(value: String) {
        val invite = PlayInvitation.parse(value)
        if (invite == null) { play.report(IllegalArgumentException("That is not a valid Sotto game invitation.")); return }
        viewModelScope.launch {
            try { play.acceptInvitation(invite) }
            catch (error: Exception) { play.report(error) }
        }
    }

    override fun onCleared() { play.setForeground(false) }
}
